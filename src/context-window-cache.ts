import { JsonCache, claudeRecallPath, objectOr } from './cache-store.js';

export interface ContextWindowData {
  used_percentage?: number;
}

interface ContextCacheEntry {
  used_percentage: number;
  at: string;
}

type ContextCache = Record<string, ContextCacheEntry>;

const cacheStore = new JsonCache<ContextCache>(claudeRecallPath('context-windows.json'), objectOr(() => ({})));

function readCache(): ContextCache {
  return cacheStore.read();
}

function writeCache(cache: ContextCache): void {
  cacheStore.write(cache);
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
