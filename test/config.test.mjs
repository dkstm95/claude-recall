import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isolateProcess } from './helpers/environment.mjs';
import { readConfig } from '../dist/config.js';

const home = mkdtempSync(join(tmpdir(), 'recall-config-'));
isolateProcess(home);
const dir = join(home, '.claude', 'claude-recall');
mkdirSync(dir, { recursive: true });
process.on('exit', () => rmSync(home, { recursive: true, force: true }));

test('explicit line3 opt-out wins over legacy context migration', () => {
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ line2: ['context'], line3: [] }));
  assert.deepEqual(readConfig().line3, []);
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ line2: ['context'] }));
  assert.ok(readConfig().line3.includes('context'));
});

test('new metadata remains opt-in and accepts supported slots', () => {
  writeFileSync(join(dir, 'config.json'), '{}');
  assert.ok(!readConfig().line1.includes('fast_mode'));
  assert.ok(!readConfig().line3.includes('spend_limit'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ line1: ['review', 'fast_mode'], line3: ['spend_limit', 'prompt_cache'] }));
  assert.deepEqual(readConfig().line1, ['review', 'fast_mode']);
  assert.deepEqual(readConfig().line3, ['spend_limit', 'prompt_cache']);
});

test('widthReserve accepts explicit margins and rejects malformed values', () => {
  for (const [value, expected] of [[0, 0], [10, 10], [-1, 6], [1.5, 6], ['8', 6], [null, 6], [1001, 6]]) {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ widthReserve: value }));
    assert.equal(readConfig().widthReserve, expected);
  }
});
