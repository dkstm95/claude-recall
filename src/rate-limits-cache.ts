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

export function mergeRateLimits(
  live: RateLimitsData | undefined,
  cache: RateLimitsData | null,
): RateLimitsData | undefined {
  const liveFive = live?.five_hour;
  const liveSeven = live?.seven_day;
  const cacheFive = cache?.five_hour;
  const cacheSeven = cache?.seven_day;
  const merged: RateLimitsData = {};
  if (hasPct(liveFive)) merged.five_hour = liveFive;
  else if (hasPct(cacheFive)) merged.five_hour = cacheFive;
  if (hasPct(liveSeven)) merged.seven_day = liveSeven;
  else if (hasPct(cacheSeven)) merged.seven_day = cacheSeven;
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
