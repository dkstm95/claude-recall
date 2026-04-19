import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
const BASE_DIR = join(homedir(), '.claude', 'claude-recall');
const CACHE_PATH = join(BASE_DIR, 'context-windows.json');
function readCache() {
    try {
        const raw = readFileSync(CACHE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        // missing/corrupt cache is harmless — fall through to empty
    }
    return {};
}
function writeCache(cache) {
    try {
        mkdirSync(BASE_DIR, { recursive: true });
        const tmp = `${CACHE_PATH}.tmp.${randomUUID()}`;
        writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
        renameSync(tmp, CACHE_PATH);
    }
    catch {
        // best-effort; cache miss on next read is harmless
    }
}
export function readContextCache() {
    return readCache();
}
export function writeContextCache(cache) {
    writeCache(cache);
}
// Claude Code omits `context_window` from statusline stdin until the first
// API call in a new client connection populates token accounting. For brand
// new sessions that's accurate (no conversation yet ≈ 0%), but for resumed
// sessions the first render hides the ctx bar despite the session actually
// having N% used. Persisting per-session lets Line 3 render the last-known
// value immediately on entry, then the live value takes over from the first
// prompt onward. Keyed by session_id so parallel sessions don't contaminate.
export function resolveContextWindow(sessionId, live) {
    const cache = readCache();
    const livePct = live?.used_percentage;
    if (typeof livePct === 'number') {
        const cachedPct = cache[sessionId]?.used_percentage;
        if (cachedPct !== livePct) {
            cache[sessionId] = { used_percentage: livePct, at: new Date().toISOString() };
            writeCache(cache);
        }
        return { used_percentage: livePct };
    }
    const cachedPct = cache[sessionId]?.used_percentage;
    if (typeof cachedPct === 'number') {
        return { used_percentage: cachedPct };
    }
    return undefined;
}
export function cleanupContextCache(keptSessionIds) {
    const cache = readCache();
    let changed = false;
    for (const id of Object.keys(cache)) {
        if (!keptSessionIds.has(id)) {
            delete cache[id];
            changed = true;
        }
    }
    if (changed)
        writeCache(cache);
}
