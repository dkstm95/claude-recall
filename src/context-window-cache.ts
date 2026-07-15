import { join } from 'node:path';
import { readJsonFile, withFileLock, writeJsonFileAtomic } from './json-file.js';
import { normalizePercentage } from './metrics.js';
import { getRecallDir } from './paths.js';

export interface ContextWindowData {
  used_percentage?: number;
}

interface ContextCacheEntry {
  used_percentage: number;
  at: string;
}

type ContextCache = Record<string, ContextCacheEntry>;

const BASE_DIR = getRecallDir();
const CACHE_PATH = join(BASE_DIR, 'context-windows.json');

function getEntry(cache: ContextCache, sessionId: string): ContextCacheEntry | undefined {
  return Object.prototype.hasOwnProperty.call(cache, sessionId) ? cache[sessionId] : undefined;
}

function setEntry(cache: ContextCache, sessionId: string, entry: ContextCacheEntry): void {
  // defineProperty treats "__proto__" and other inherited names as plain data
  // keys instead of invoking Object.prototype setters.
  Object.defineProperty(cache, sessionId, {
    value: entry,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function readCache(): ContextCache {
  const parsed = readJsonFile<unknown>(CACHE_PATH);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const cache: ContextCache = {};
    for (const [sessionId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const percentage = normalizePercentage(entry['used_percentage']);
      if (percentage === undefined) continue;
      setEntry(cache, sessionId, {
        used_percentage: percentage,
        at: typeof entry['at'] === 'string' ? entry['at'] : new Date(0).toISOString(),
      });
    }
    return cache;
  }
  return {};
}

function writeCache(cache: ContextCache): void {
  try {
    writeJsonFileAtomic(CACHE_PATH, cache);
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
export async function resolveContextWindow(
  sessionId: string,
  live: ContextWindowData | undefined,
): Promise<ContextWindowData> {
  const livePct = normalizePercentage(live?.used_percentage);
  const snapshot = readCache();
  const cachedPct = getEntry(snapshot, sessionId)?.used_percentage;
  // Atomic rename makes unlocked reads safe, and the common no-live/unchanged
  // render path should not queue behind unrelated sessions.
  if (livePct === undefined) return { used_percentage: cachedPct ?? 0 };
  if (cachedPct === livePct) return { used_percentage: livePct };

  try {
    return await withFileLock(CACHE_PATH, () => {
      const cache = readCache();
      if (getEntry(cache, sessionId)?.used_percentage !== livePct) {
        setEntry(cache, sessionId, { used_percentage: livePct, at: new Date().toISOString() });
        writeCache(cache);
      }
      return { used_percentage: livePct };
    });
  } catch {
    // Cache contention or an unwritable config directory must not blank the
    // statusline. Live stdin remains authoritative even if persistence fails.
    return { used_percentage: livePct };
  }
}

export async function cleanupContextCache(keptSessionIds: Set<string>): Promise<void> {
  if (!Object.keys(readCache()).some((id) => !keptSessionIds.has(id))) return;
  try {
    await withFileLock(CACHE_PATH, () => {
      const cache = readCache();
      let changed = false;
      for (const id of Object.keys(cache)) {
        if (!keptSessionIds.has(id)) {
          delete cache[id];
          changed = true;
        }
      }
      if (changed) writeCache(cache);
    }, { timeoutMs: 250 });
  } catch {
    // Cleanup is opportunistic and must never block SessionStart.
  }
}
