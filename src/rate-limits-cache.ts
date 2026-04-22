import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface RateLimitWindow {
  used_percentage?: number;
  resets_at?: number;
}

export interface RateLimitsData {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

const BASE_DIR = join(homedir(), '.claude', 'claude-recall');
const CACHE_PATH = join(BASE_DIR, 'rate-limits.json');

function hasPct(w: RateLimitWindow | undefined): w is RateLimitWindow {
  return !!w && typeof w.used_percentage === 'number';
}

// A window is "fresh" only while its reset hasn't fired — once the window rolls
// over, the cached percentage is stale (actual usage is 0 in the new window).
function isFresh(w: RateLimitWindow | undefined, nowMs: number): boolean {
  if (!hasPct(w)) return false;
  if (typeof w.resets_at !== 'number') return false;
  return w.resets_at * 1000 > nowMs;
}

function windowsEqual(a: RateLimitWindow | undefined, b: RateLimitWindow | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.used_percentage === b.used_percentage && a.resets_at === b.resets_at;
}

function dataEqual(
  a: RateLimitsData | null | undefined,
  b: RateLimitsData | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return windowsEqual(a.five_hour, b.five_hour) && windowsEqual(a.seven_day, b.seven_day);
}

export function readRateLimitsCache(nowMs: number = Date.now()): RateLimitsData | null {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as RateLimitsData;
    const out: RateLimitsData = {};
    if (isFresh(parsed.five_hour, nowMs)) out.five_hour = parsed.five_hour;
    if (isFresh(parsed.seven_day, nowMs)) out.seven_day = parsed.seven_day;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function writeRateLimitsCache(data: RateLimitsData): void {
  try {
    mkdirSync(BASE_DIR, { recursive: true });
    const tmp = `${CACHE_PATH}.tmp.${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    renameSync(tmp, CACHE_PATH);
  } catch {
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
function mergeWindow(
  live: RateLimitWindow | undefined,
  cache: RateLimitWindow | undefined,
): RateLimitWindow | undefined {
  if (hasPct(live)) {
    if (typeof live.resets_at === 'number') return live;
    if (typeof cache?.resets_at === 'number') {
      return { used_percentage: live.used_percentage, resets_at: cache.resets_at };
    }
    return live;
  }
  if (hasPct(cache)) return cache;
  return undefined;
}

export function mergeRateLimits(
  live: RateLimitsData | undefined,
  cache: RateLimitsData | null,
): RateLimitsData | undefined {
  const merged: RateLimitsData = {};
  const fiveHour = mergeWindow(live?.five_hour, cache?.five_hour ?? undefined);
  if (fiveHour) merged.five_hour = fiveHour;
  const sevenDay = mergeWindow(live?.seven_day, cache?.seven_day ?? undefined);
  if (sevenDay) merged.seven_day = sevenDay;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function hasAnyLivePct(live: RateLimitsData | undefined): boolean {
  return hasPct(live?.five_hour) || hasPct(live?.seven_day);
}

// Claude Code's statusline stdin omits `rate_limits` on first render (before
// the first API call). Persisting the last-seen live values lets line 3 render
// immediately on session entry. Cache writes are skipped when no live data
// arrived or the merged value is unchanged, so this stays cheap at the ~300ms
// render cadence.
export function resolveRateLimits(live: RateLimitsData | undefined): RateLimitsData | undefined {
  const cache = readRateLimitsCache();
  const merged = mergeRateLimits(live, cache);
  if (hasAnyLivePct(live) && merged && !dataEqual(cache, merged)) {
    writeRateLimitsCache(merged);
  }
  return merged;
}
