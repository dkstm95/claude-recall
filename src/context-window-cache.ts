import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface ContextWindowData {
  used_percentage?: number;
}

interface ContextCacheEntry {
  used_percentage: number;
  at: string;
}

type ContextCache = Record<string, ContextCacheEntry>;

const BASE_DIR = join(homedir(), '.claude', 'claude-recall');
const CACHE_PATH = join(BASE_DIR, 'context-windows.json');

function readCache(): ContextCache {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ContextCache;
    }
  } catch {
    // missing/corrupt cache is harmless — fall through to empty
  }
  return {};
}

function writeCache(cache: ContextCache): void {
  try {
    mkdirSync(BASE_DIR, { recursive: true });
    const tmp = `${CACHE_PATH}.tmp.${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
    renameSync(tmp, CACHE_PATH);
  } catch {
    // best-effort; cache miss on next read is harmless
  }
}

export function readContextCache(): ContextCache {
  return readCache();
}

export function writeContextCache(cache: ContextCache): void {
  writeCache(cache);
}

// Claude Code omits `context_window` from statusline stdin until the first
// API call in a new client connection populates token accounting. Resolution
// priority: live stdin value > per-session cache > 0% fallback. The fallback
// keeps the ctx bar on screen from the very first render: for brand-new
// sessions 0% is accurate (no conversation yet), and for rare cases where
// a resumed session has no cache entry (pre-v6.1.4 sessions, manual cache
// deletion) the display self-corrects on the first prompt when the live
// value arrives. Keyed by session_id so parallel sessions don't contaminate.
export function resolveContextWindow(
  sessionId: string,
  live: ContextWindowData | undefined,
): ContextWindowData {
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
  return { used_percentage: 0 };
}

export function cleanupContextCache(keptSessionIds: Set<string>): void {
  const cache = readCache();
  let changed = false;
  for (const id of Object.keys(cache)) {
    if (!keptSessionIds.has(id)) {
      delete cache[id];
      changed = true;
    }
  }
  if (changed) writeCache(cache);
}
