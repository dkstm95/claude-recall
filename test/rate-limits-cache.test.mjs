import { isolateProcess } from './helpers/environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate every Claude storage override before importing cache modules.
const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-cache-test-'));
isolateProcess(tmpHome);
process.on('exit', () => {
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

const {
  rateLimitsCachePath,
  readRateLimitsCache,
  writeRateLimitsCache,
  mergeRateLimits,
  hasAnyLivePct,
  resolveRateLimits,
} = await import('../dist/rate-limits-cache.js');

const cacheDir = join(tmpHome, '.claude', 'claude-recall', 'rate-limits');
const cachePath = rateLimitsCachePath('test-session');
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

// Regression (v6.2.2 → v6.2.3): Claude Code occasionally streams rate_limits
// with just used_percentage (no resets_at). The previous window-level merge
// took live as-is and discarded the cached resets_at, so the 7d bar rendered
// without its "(~M/D HH:MM)" reset text. Field-wise merge preserves the
// cached resets_at as long as readRateLimitsCache still considers it fresh.
test('mergeRateLimits: cached resets_at fills gap when live has used_percentage only', () => {
  const live = { seven_day: { used_percentage: 67 } };
  const cache = { seven_day: { used_percentage: 50, resets_at: 2_000_500_000 } };
  const out = mergeRateLimits(live, cache);
  assert.equal(out.seven_day.used_percentage, 67, 'live used_percentage wins');
  assert.equal(out.seven_day.resets_at, 2_000_500_000, 'cached resets_at carries over');
});

test('mergeRateLimits: live resets_at wins over cache resets_at', () => {
  const live = { five_hour: { used_percentage: 30, resets_at: 2_000_900_000 } };
  const cache = { five_hour: { used_percentage: 20, resets_at: 2_000_100_000 } };
  const out = mergeRateLimits(live, cache);
  assert.equal(out.five_hour.used_percentage, 30);
  assert.equal(out.five_hour.resets_at, 2_000_900_000);
});

test('mergeRateLimits: live used_percentage only + no cache → no resets_at', () => {
  const live = { seven_day: { used_percentage: 67 } };
  const out = mergeRateLimits(live, null);
  assert.equal(out.seven_day.used_percentage, 67);
  assert.equal(out.seven_day.resets_at, undefined, 'no resets_at available anywhere');
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
  const out = readRateLimitsCache('test-session');
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
  assert.equal(readRateLimitsCache('test-session'), null);
  cleanupCache();
});

test('readRateLimitsCache: returns null when file missing', () => {
  cleanupCache();
  assert.equal(readRateLimitsCache('test-session'), null);
});

test('writeRateLimitsCache then readRateLimitsCache round-trips', () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  const data = {
    five_hour: { used_percentage: 33, resets_at: nowSec + 3600 },
    seven_day: { used_percentage: 44, resets_at: nowSec + 86400 },
  };
  writeRateLimitsCache('test-session', data);
  const out = readRateLimitsCache('test-session');
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

test('resolveRateLimits: persists new live data to the cache', async () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  const live = { five_hour: { used_percentage: 25, resets_at: nowSec + 3600 } };
  const out = await resolveRateLimits('test-session', live);
  assert.equal(out.five_hour.used_percentage, 25);
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'));
  assert.equal(onDisk.five_hour.used_percentage, 25);
  cleanupCache();
});

test('resolveRateLimits: skips write when live matches cache (no-op guard)', async () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  const data = { five_hour: { used_percentage: 40, resets_at: nowSec + 3600 } };
  writeRateLimitsCache('test-session', data);
  const mtimeBefore = statSync(cachePath).mtimeMs;
  // Sleep briefly so mtime granularity would reflect any rewrite.
  const spin = Date.now() + 20;
  while (Date.now() < spin) { /* busy-wait 20ms */ }
  await resolveRateLimits('test-session', data);
  const mtimeAfter = statSync(cachePath).mtimeMs;
  assert.equal(mtimeAfter, mtimeBefore, 'cache file must not be rewritten when content is unchanged');
  cleanupCache();
});

test('resolveRateLimits: writes when live brings a different percentage than cache', async () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  writeRateLimitsCache('test-session', { five_hour: { used_percentage: 30, resets_at: nowSec + 3600 } });
  const out = await resolveRateLimits('test-session', { five_hour: { used_percentage: 55, resets_at: nowSec + 3600 } });
  assert.equal(out.five_hour.used_percentage, 55);
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf-8'));
  assert.equal(onDisk.five_hour.used_percentage, 55);
  cleanupCache();
});

test('resolveRateLimits: concurrent partial windows do not lose one another', async () => {
  cleanupCache();
  const nowSec = Math.floor(Date.now() / 1000);
  await Promise.all([
    resolveRateLimits('test-session', { five_hour: { used_percentage: 25, resets_at: nowSec + 3600 } }),
    resolveRateLimits('test-session', { seven_day: { used_percentage: 50, resets_at: nowSec + 86400 } }),
  ]);
  const cached = readRateLimitsCache('test-session');
  assert.equal(cached.five_hour.used_percentage, 25);
  assert.equal(cached.seven_day.used_percentage, 50);
  cleanupCache();
});

test('resolveRateLimits: sessions never inherit another session or legacy account cache', async () => {
  const data = { five_hour: { used_percentage: 87, resets_at: Date.now() / 1000 + 3600 } };
  writeFileSync(join(tmpHome, '.claude', 'claude-recall', 'rate-limits.json'), JSON.stringify(data));
  await resolveRateLimits('account-a-session', data);
  assert.equal(await resolveRateLimits('account-b-session', undefined), undefined);
  assert.equal((await resolveRateLimits('account-a-session', undefined)).five_hour.used_percentage, 87);
});

test('spend limits preserve overage while subscription percentages stay bounded', async () => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const result = await resolveRateLimits('spend-session', {
    five_hour: { used_percentage: 145, resets_at: expires },
    spend_limit: { used_percentage: 145, resets_at: expires },
  });
  assert.equal(result.five_hour.used_percentage, 100);
  assert.equal(result.spend_limit.used_percentage, 145);
  assert.equal(readRateLimitsCache('spend-session').spend_limit.used_percentage, 145);
  assert.equal((await resolveRateLimits('spend-session', undefined)).spend_limit.used_percentage, 145);
});

test('cleanup rechecks age under the write lock and preserves a concurrent refresh', async () => {
  const { utimesSync } = await import('node:fs');
  const { withFileLock } = await import('../dist/json-file.js');
  const { cleanupRateLimitsCache } = await import('../dist/rate-limits-cache.js');
  const session = 'cleanup-race';
  const data = { five_hour: { used_percentage: 20, resets_at: Date.now() / 1000 + 3600 } };
  writeRateLimitsCache(session, data);
  const path = rateLimitsCachePath(session);
  const old = new Date(Date.now() - 8 * 86_400_000);
  utimesSync(path, old, old);
  let cleaning;
  await withFileLock(path, () => {
    cleaning = cleanupRateLimitsCache();
    writeRateLimitsCache(session, { ...data, seven_day: { used_percentage: 5, resets_at: Date.now() / 1000 + 86400 } });
  });
  await cleaning;
  assert.equal(readRateLimitsCache(session).seven_day.used_percentage, 5);
  utimesSync(path, old, old);
  await cleanupRateLimitsCache();
  assert.equal(existsSync(path), false);
});
