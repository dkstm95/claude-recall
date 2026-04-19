import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The cache module writes to ~/.claude/claude-recall/rate-limits.json. Redirect
// HOME before import so tests don't touch the user's real cache.
const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-cache-test-'));
process.env['HOME'] = tmpHome;
process.env['USERPROFILE'] = tmpHome;
process.on('exit', () => {
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

const {
  readRateLimitsCache,
  writeRateLimitsCache,
  mergeRateLimits,
  hasAnyLivePct,
  resolveRateLimits,
} = await import('../dist/rate-limits-cache.js');

const cacheDir = join(tmpHome, '.claude', 'claude-recall');
const cachePath = join(cacheDir, 'rate-limits.json');
mkdirSync(cacheDir, { recursive: true });

function cleanupCache() {
  if (existsSync(cachePath)) rmSync(cachePath);
}

test('mergeRateLimits: live wins over cache', () => {
  const live = { five_hour: { used_percentage: 45, resets_at: 2_000_000_000 } };
  const cache = { five_hour: { used_percentage: 10, resets_at: 2_000_000_000 } };
  const out = mergeRateLimits(live, cache);
  assert.equal(out.five_hour.used_percentage, 45);
});

test('mergeRateLimits: cache fills gap when live is undefined', () => {
  const cache = {
    five_hour: { used_percentage: 30, resets_at: 2_000_000_000 },
    seven_day: { used_percentage: 12, resets_at: 2_000_500_000 },
  };
  const out = mergeRateLimits(undefined, cache);
  assert.equal(out.five_hour.used_percentage, 30);
  assert.equal(out.seven_day.used_percentage, 12);
});

test('mergeRateLimits: partial live + cache (live 5h, cached 7d)', () => {
  const live = { five_hour: { used_percentage: 55, resets_at: 2_000_000_000 } };
  const cache = { seven_day: { used_percentage: 22, resets_at: 2_000_500_000 } };
  const out = mergeRateLimits(live, cache);
  assert.equal(out.five_hour.used_percentage, 55);
  assert.equal(out.seven_day.used_percentage, 22);
});

test('readRateLimitsCache: drops windows whose resets_at has passed', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(
    cachePath,
    JSON.stringify({
      five_hour: { used_percentage: 50, resets_at: nowSec - 10 },      // stale
      seven_day: { used_percentage: 20, resets_at: nowSec + 86400 },   // fresh
    }),
    'utf-8',
  );
  const out = readRateLimitsCache();
  assert.equal(out.five_hour, undefined, 'stale 5h window must be dropped');
  assert.equal(out.seven_day.used_percentage, 20);
  cleanupCache();
});

test('readRateLimitsCache: returns null when entirely stale', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(
    cachePath,
    JSON.stringify({
      five_hour: { used_percentage: 50, resets_at: nowSec - 10 },
      seven_day: { used_percentage: 20, resets_at: nowSec - 10 },
    }),
    'utf-8',
  );
  assert.equal(readRateLimitsCache(), null);
  cleanupCache();
});

test('readRateLimitsCache: returns null when file missing', () => {
  cleanupCache();
  assert.equal(readRateLimitsCache(), null);
});

test('writeRateLimitsCache then readRateLimitsCache round-trips', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  const data = {
    five_hour: { used_percentage: 33, resets_at: nowSec + 3600 },
    seven_day: { used_percentage: 44, resets_at: nowSec + 86400 },
  };
  writeRateLimitsCache(data);
  const out = readRateLimitsCache();
  assert.deepEqual(out, data);
  cleanupCache();
});

test('hasAnyLivePct: true when any window has used_percentage', () => {
  assert.equal(hasAnyLivePct({ five_hour: { used_percentage: 0 } }), true);
  assert.equal(hasAnyLivePct({ seven_day: { used_percentage: 0 } }), true);
  assert.equal(hasAnyLivePct({}), false);
  assert.equal(hasAnyLivePct(undefined), false);
  assert.equal(hasAnyLivePct({ five_hour: { resets_at: 123 } }), false);
});

test('resolveRateLimits: persists new live data to the cache', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  const live = { five_hour: { used_percentage: 25, resets_at: nowSec + 3600 } };
  const out = resolveRateLimits(live);
  assert.equal(out.five_hour.used_percentage, 25);
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'));
  assert.equal(onDisk.five_hour.used_percentage, 25);
  cleanupCache();
});

test('resolveRateLimits: skips write when live matches cache (no-op guard)', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  const data = { five_hour: { used_percentage: 40, resets_at: nowSec + 3600 } };
  writeRateLimitsCache(data);
  const mtimeBefore = statSync(cachePath).mtimeMs;
  // Sleep briefly so mtime granularity would reflect any rewrite.
  const spin = Date.now() + 20;
  while (Date.now() < spin) { /* busy-wait 20ms */ }
  resolveRateLimits(data);
  const mtimeAfter = statSync(cachePath).mtimeMs;
  assert.equal(mtimeAfter, mtimeBefore, 'cache file must not be rewritten when content is unchanged');
  cleanupCache();
});

test('resolveRateLimits: writes when live brings a different percentage than cache', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  writeRateLimitsCache({ five_hour: { used_percentage: 30, resets_at: nowSec + 3600 } });
  const out = resolveRateLimits({ five_hour: { used_percentage: 55, resets_at: nowSec + 3600 } });
  assert.equal(out.five_hour.used_percentage, 55);
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'));
  assert.equal(onDisk.five_hour.used_percentage, 55);
  cleanupCache();
});
