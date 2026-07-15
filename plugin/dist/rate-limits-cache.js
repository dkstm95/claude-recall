import { join } from 'node:path';
import { readJsonFile, withFileLock, writeJsonFileAtomic } from './json-file.js';
import { normalizeEpochSeconds, normalizePercentage } from './metrics.js';
import { getRecallDir } from './paths.js';
const BASE_DIR = getRecallDir();
const CACHE_PATH = join(BASE_DIR, 'rate-limits.json');
function hasPct(w) {
    return !!w && normalizePercentage(w.used_percentage) !== undefined;
}
function normalizeWindow(w) {
    const usedPercentage = normalizePercentage(w?.used_percentage);
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
    return windowsEqual(a.five_hour, b.five_hour) && windowsEqual(a.seven_day, b.seven_day);
}
export function readRateLimitsCache(nowMs = Date.now()) {
    const raw = readJsonFile(CACHE_PATH);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const parsed = raw;
    const fiveHour = normalizeWindow(parsed.five_hour);
    const sevenDay = normalizeWindow(parsed.seven_day);
    const out = {};
    if (isFresh(fiveHour, nowMs))
        out.five_hour = fiveHour;
    if (isFresh(sevenDay, nowMs))
        out.seven_day = sevenDay;
    return Object.keys(out).length > 0 ? out : null;
}
export function writeRateLimitsCache(data) {
    try {
        writeJsonFileAtomic(CACHE_PATH, data);
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
function mergeWindow(live, cache) {
    const normalizedLive = normalizeWindow(live);
    const normalizedCache = normalizeWindow(cache);
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
    return Object.keys(merged).length > 0 ? merged : undefined;
}
export function hasAnyLivePct(live) {
    return hasPct(live?.five_hour) || hasPct(live?.seven_day);
}
// Claude Code's statusline stdin omits `rate_limits` on first render (before
// the first API call). Persisting the last-seen live values lets line 3 render
// immediately on session entry. Cache writes are skipped when no live data
// arrived or the merged value is unchanged, so this stays cheap at the ~300ms
// render cadence.
export async function resolveRateLimits(live) {
    const snapshot = readRateLimitsCache();
    const initialMerged = mergeRateLimits(live, snapshot);
    if (!hasAnyLivePct(live) || !initialMerged || dataEqual(snapshot, initialMerged)) {
        return initialMerged;
    }
    try {
        return await withFileLock(CACHE_PATH, () => {
            const cache = readRateLimitsCache();
            const merged = mergeRateLimits(live, cache);
            if (hasAnyLivePct(live) && merged && !dataEqual(cache, merged)) {
                writeRateLimitsCache(merged);
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
