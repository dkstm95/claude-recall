import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
test('cache tests leave an inherited caller config untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'recall-caller-config-'));
  const cache = join(root, 'claude-recall');
  mkdirSync(cache);
  const sentinel = '{"caller-session":{"used_percentage":37,"at":"2026-10-01T00:00:00Z"}}';
  writeFileSync(join(cache, 'context-windows.json'), sentinel);
  writeFileSync(join(cache, 'rate-limits.json'), sentinel);
  try {
    await exec(process.execPath, ['--test', 'test/context-window-cache.test.mjs', 'test/rate-limits-cache.test.mjs'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: root, CLAUDE_RECALL_REFINING: '1', CLAUDE_CODE_PLUGIN_CACHE_DIR: root },
      timeout: 30_000,
    });
    assert.equal(readFileSync(join(cache, 'context-windows.json'), 'utf8'), sentinel);
    assert.equal(readFileSync(join(cache, 'rate-limits.json'), 'utf8'), sentinel);
    assert.deepEqual(readdirSync(cache).sort(), ['context-windows.json', 'rate-limits.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
