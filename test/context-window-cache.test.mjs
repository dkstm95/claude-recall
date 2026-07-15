import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Redirect HOME before importing so the cache module writes to a temp dir
// instead of the real ~/.claude/claude-recall/context-windows.json.
const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-ctx-cache-test-'));
process.env['HOME'] = tmpHome;
process.env['USERPROFILE'] = tmpHome;
process.on('exit', () => {
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

const {
  readContextCache,
  writeContextCache,
  resolveContextWindow,
  cleanupContextCache,
} = await import('../dist/context-window-cache.js');

const cacheDir = join(tmpHome, '.claude', 'claude-recall');
const cachePath = join(cacheDir, 'context-windows.json');
mkdirSync(cacheDir, { recursive: true });

function cleanupCache() {
  if (existsSync(cachePath)) rmSync(cachePath);
}

test('readContextCache: returns empty object when file missing', () => {
  cleanupCache();
  assert.deepEqual(readContextCache(), {});
});

test('readContextCache: rejects malformed JSON and returns empty', () => {
  cleanupCache();
  writeFileSync(cachePath, 'not json at all', 'utf-8');
  assert.deepEqual(readContextCache(), {});
  cleanupCache();
});

test('readContextCache: rejects array at top level (must be object)', () => {
  cleanupCache();
  writeFileSync(cachePath, '[1,2,3]', 'utf-8');
  assert.deepEqual(readContextCache(), {});
  cleanupCache();
});

test('writeContextCache then readContextCache round-trips', () => {
  cleanupCache();
  const data = { 'session-a': { used_percentage: 42, at: '2026-04-19T00:00:00.000Z' } };
  writeContextCache(data);
  assert.deepEqual(readContextCache(), data);
  cleanupCache();
});

test('resolveContextWindow: live value persisted on first observation', async () => {
  cleanupCache();
  const out = await resolveContextWindow('session-a', { used_percentage: 45 });
  assert.equal(out.used_percentage, 45);
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'));
  assert.equal(onDisk['session-a'].used_percentage, 45);
  cleanupCache();
});

test('resolveContextWindow: returns cached value when live is undefined (the Claude Code first-render case)', async () => {
  cleanupCache();
  writeContextCache({ 'session-a': { used_percentage: 72, at: '2026-04-19T00:00:00.000Z' } });
  const out = await resolveContextWindow('session-a', undefined);
  assert.equal(out.used_percentage, 72);
  cleanupCache();
});

test('resolveContextWindow: returns cached value when live has no used_percentage field', async () => {
  cleanupCache();
  writeContextCache({ 'session-a': { used_percentage: 55, at: '2026-04-19T00:00:00.000Z' } });
  const out = await resolveContextWindow('session-a', {});
  assert.equal(out.used_percentage, 55);
  cleanupCache();
});

test('resolveContextWindow: returns 0% when both live and cache are empty (brand-new session)', async () => {
  cleanupCache();
  const out = await resolveContextWindow('session-new', undefined);
  assert.equal(out.used_percentage, 0);
});

test('resolveContextWindow: 0% fallback does not populate the cache', async () => {
  cleanupCache();
  await resolveContextWindow('session-new', undefined);
  assert.deepEqual(readContextCache(), {});
});

test('resolveContextWindow: skips write when live matches cache (no-op guard)', async () => {
  cleanupCache();
  writeContextCache({ 'session-a': { used_percentage: 30, at: '2026-04-19T00:00:00.000Z' } });
  const mtimeBefore = statSync(cachePath).mtimeMs;
  const spin = Date.now() + 20;
  while (Date.now() < spin) { /* busy-wait so mtime granularity reflects any rewrite */ }
  await resolveContextWindow('session-a', { used_percentage: 30 });
  const mtimeAfter = statSync(cachePath).mtimeMs;
  assert.equal(mtimeAfter, mtimeBefore, 'cache file must not be rewritten when value is unchanged');
  cleanupCache();
});

test('resolveContextWindow: writes when live pct differs from cached pct', async () => {
  cleanupCache();
  writeContextCache({ 'session-a': { used_percentage: 30, at: '2026-04-19T00:00:00.000Z' } });
  const out = await resolveContextWindow('session-a', { used_percentage: 50 });
  assert.equal(out.used_percentage, 50);
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'));
  assert.equal(onDisk['session-a'].used_percentage, 50);
  cleanupCache();
});

test('resolveContextWindow: concurrent sessions preserve every cache entry', async () => {
  cleanupCache();
  const count = 40;
  await Promise.all(Array.from({ length: count }, (_, i) =>
    resolveContextWindow(`session-${i}`, { used_percentage: i })));
  const cache = readContextCache();
  assert.equal(Object.keys(cache).length, count);
  for (let i = 0; i < count; i++) assert.equal(cache[`session-${i}`].used_percentage, i);
  cleanupCache();
});

test('resolveContextWindow: prototype-like session ids persist as ordinary keys', async () => {
  cleanupCache();
  const out = await resolveContextWindow('__proto__', { used_percentage: 42 });
  assert.equal(out.used_percentage, 42);
  const cache = readContextCache();
  assert.equal(Object.prototype.hasOwnProperty.call(cache, '__proto__'), true);
  assert.equal(cache['__proto__'].used_percentage, 42);
  cleanupCache();
});

test('cleanupContextCache: removes entries for sessions not in the kept set', async () => {
  cleanupCache();
  writeContextCache({
    'alive-1': { used_percentage: 10, at: '2026-04-19T00:00:00.000Z' },
    'alive-2': { used_percentage: 20, at: '2026-04-19T00:00:00.000Z' },
    'stale-1': { used_percentage: 30, at: '2026-04-10T00:00:00.000Z' },
  });
  await cleanupContextCache(new Set(['alive-1', 'alive-2']));
  const after = readContextCache();
  assert.deepEqual(Object.keys(after).sort(), ['alive-1', 'alive-2']);
  cleanupCache();
});

test('cleanupContextCache: skips write when nothing to remove', async () => {
  cleanupCache();
  writeContextCache({ 'alive-1': { used_percentage: 10, at: '2026-04-19T00:00:00.000Z' } });
  const mtimeBefore = statSync(cachePath).mtimeMs;
  const spin = Date.now() + 20;
  while (Date.now() < spin) { /* busy-wait */ }
  await cleanupContextCache(new Set(['alive-1']));
  const mtimeAfter = statSync(cachePath).mtimeMs;
  assert.equal(mtimeAfter, mtimeBefore, 'cache file must not be rewritten when no entries were pruned');
  cleanupCache();
});
