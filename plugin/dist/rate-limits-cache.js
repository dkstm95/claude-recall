import { createHash } from 'node:crypto';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, withFileLock, writeJsonFileAtomic } from './json-file.js';
import { normalizeEpochSeconds, normalizeNonNegativeNumber, normalizePercentage } from './metrics.js';
import { getRecallDir } from './paths.js';
const BASE_DIR = getRecallDir();
const CACHE_DIR = join(BASE_DIR, 'rate-limits');
export function rateLimitsCachePath(sessionId) {
    return join(CACHE_DIR, `${createHash('sha256').update(sessionId).digest('hex')}.json`);
}
export async function cleanupRateLimitsCache() {
    try {
        for (const name of readdirSync(CACHE_DIR)) {
            if (!/^[a-f0-9]{64}\.json$/.test(name))
                continue;
            const path = join(CACHE_DIR, name);
            if (Date.now() - statSync(path).mtimeMs <= 7 * 86_400_000)
                continue;
            await withFileLock(path, () => {
                try {
                    if (Date.now() - statSync(path).mtimeMs > 7 * 86_400_000)
                        unlinkSync(path);
                }
                catch { /* another cleanup may already have removed it */ }
            });
        }
    }
    catch { /* best-effort cleanup on SessionStart */ }
}
function hasPct(w) {
    return !!w && normalizePercentage(w.used_percentage) !== undefined;
}
function normalizeWindow(w, spend = false) {
    const usedPercentage = (spend ? normalizeNonNegativeNumber : normalizePercentage)(w?.used_percentage);
    if (usedPercentage === undefined)
        return undefined;
    const resetsAt = normalizeEpochSeconds(w?.resets_at);
    return resetsAt === undefined
        ? { used_percentage: usedPercentage }
        : { used_percentage: usedPercentage, resets_at: resetsAt };
}
// A window is "fresh" only while its reset hasn't fired — once the window rolls
// over, the cached percentage is stale (actual usage is 0 in the new window).
function isFresh(w, nowMs) {
    if (!hasPct(w))
        return false;
    if (typeof w.resets_at !== 'number')
        return false;
    return w.resets_at * 1000 > nowMs;
}
function windowsEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    return a.used_percentage === b.used_percentage && a.resets_at === b.resets_at;
}
function dataEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    return windowsEqual(a.five_hour, b.five_hour) && windowsEqual(a.seven_day, b.seven_day) && windowsEqual(a.spend_limit, b.spend_limit);
}
export function readRateLimitsCache(sessionId, nowMs = Date.now()) {
    const raw = readJsonFile(rateLimitsCachePath(sessionId));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const parsed = raw;
    const fiveHour = normalizeWindow(parsed.five_hour);
    const sevenDay = normalizeWindow(parsed.seven_day);
    const spendLimit = normalizeWindow(parsed.spend_limit, true);
    const out = {};
    if (isFresh(fiveHour, nowMs))
        out.five_hour = fiveHour;
    if (isFresh(sevenDay, nowMs))
        out.seven_day = sevenDay;
    if (isFresh(spendLimit, nowMs))
        out.spend_limit = spendLimit;
    return Object.keys(out).length > 0 ? out : null;
}
export function writeRateLimitsCache(sessionId, data) {
    try {
        writeJsonFileAtomic(rateLimitsCachePath(sessionId), data);
    }
    catch {
        // best-effort; cache miss on next read is harmless
    }
}
// Field-wise merge within each window: live's used_percentage is authoritative,
// but resets_at falls back to cache when live omits it. Claude Code sometimes
// streams `rate_limits.<window>` with just `used_percentage` (no `resets_at`)
// between full rate-limit responses; without this fallback, the Line 3 reset
// text disappears until the next full payload arrives. `readRateLimitsCache`
// already filters stale cache entries, so we can trust any cache resets_at we
// see here.
function mergeWindow(live, cache, spend = false) {
    const normalizedLive = normalizeWindow(live, spend);
    const normalizedCache = normalizeWindow(cache, spend);
    if (hasPct(normalizedLive)) {
        if (typeof normalizedLive.resets_at === 'number')
            return normalizedLive;
        if (typeof normalizedCache?.resets_at === 'number') {
            return { used_percentage: normalizedLive.used_percentage, resets_at: normalizedCache.resets_at };
        }
        return normalizedLive;
    }
    if (hasPct(normalizedCache))
        return normalizedCache;
    return undefined;
}
export function mergeRateLimits(live, cache) {
    const merged = {};
    const fiveHour = mergeWindow(live?.five_hour, cache?.five_hour ?? undefined);
    if (fiveHour)
        merged.five_hour = fiveHour;
    const sevenDay = mergeWindow(live?.seven_day, cache?.seven_day ?? undefined);
    if (sevenDay)
        merged.seven_day = sevenDay;
    const spend = mergeWindow(live?.spend_limit, cache?.spend_limit, true);
    if (spend)
        merged.spend_limit = spend;
    return Object.keys(merged).length > 0 ? merged : undefined;
}
export function hasAnyLivePct(live) {
    return hasPct(live?.five_hour) || hasPct(live?.seven_day) || hasPct(live?.spend_limit);
}
// Claude Code's statusline stdin omits `rate_limits` on first render (before
// the first API call). Persisting the last-seen live values lets line 3 render
// immediately on a resumed session. New sessions never inherit another session's
// quota. Writes are skipped when no live data arrived or values are unchanged,
// keeping this cheap at the ~300ms
// render cadence.
export async function resolveRateLimits(sessionId, live) {
    const snapshot = readRateLimitsCache(sessionId);
    const initialMerged = mergeRateLimits(live, snapshot);
    if (!hasAnyLivePct(live) || !initialMerged || dataEqual(snapshot, initialMerged)) {
        return initialMerged;
    }
    try {
        return await withFileLock(rateLimitsCachePath(sessionId), () => {
            const cache = readRateLimitsCache(sessionId);
            const merged = mergeRateLimits(live, cache);
            if (hasAnyLivePct(live) && merged && !dataEqual(cache, merged)) {
                writeRateLimitsCache(sessionId, merged);
            }
            return merged;
        });
    }
    catch {
        // Cache contention or a read-only config directory should degrade to the
        // current live/cached view, not suppress the whole statusline.
        return initialMerged;
    }
}
