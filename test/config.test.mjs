import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

function readConfigInHome(config) {
  const home = mkdtempSync(join(tmpdir(), 'claude-recall-config-test-'));
  try {
    const dir = join(home, '.claude', 'claude-recall');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    const script = `import { readConfig } from ${JSON.stringify(join(ROOT, 'dist', 'config.js'))}; process.stdout.write(JSON.stringify(readConfig()));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('readConfig: explicit empty line3 wins over legacy line2 migration', () => {
  const config = readConfigInHome({
    line2: ['turn', 'prompt', 'context'],
    line3: [],
  });
  assert.deepEqual(config.line3, []);
});

test('readConfig: duplicate slots are removed while preserving order', () => {
  const config = readConfigInHome({ line1: ['focus', 'model', 'branch', 'model'] });
  assert.deepEqual(config.line1, ['focus', 'model', 'branch']);
});
