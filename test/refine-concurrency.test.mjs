import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'claude-recall-refine-race-test-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.on('exit', () => rmSync(home, { recursive: true, force: true }));

const fakeBin = join(home, 'bin');
const callsPath = join(home, 'calls.jsonl');
const fakeClaude = join(fakeBin, 'claude');
await import('node:fs/promises').then(({ mkdir }) => mkdir(fakeBin, { recursive: true }));
writeFileSync(fakeClaude, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
let stdin = '';
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ argv: process.argv.slice(2), stdin }) + '\\n');
  setTimeout(() => process.stdout.write('race-safe focus\\n'), 150);
});
`, { mode: 0o755 });
process.env.PATH = fakeBin + delimiter + process.env.PATH;

const { createEmptySessionState, readState, updateState, writeState } = await import('../dist/state.js');
const { triggerFocusRefinement } = await import('../dist/refine.js');

test('triggerFocusRefinement: one in-flight job wins and unrelated hook fields survive', async () => {
  const sessionId = 'race-session';
  const transcriptPath = join(home, 'transcript.jsonl');
  writeFileSync(transcriptPath, '{"type":"user","message":"review concurrency"}\n');
  writeState(sessionId, createEmptySessionState(sessionId, home));

  const first = triggerFocusRefinement(sessionId, transcriptPath);
  const second = triggerFocusRefinement(sessionId, transcriptPath);

  const deadline = Date.now() + 2_000;
  while (!existsSync(callsPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  updateState(sessionId, (state) => {
    state.promptCount = 2;
    state.lastUserPrompt = 'newer prompt';
    state.cwd = '/new/cwd';
  });

  await Promise.all([first, second]);
  const calls = readFileSync(callsPath, 'utf-8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1, 'only one Haiku subprocess should run per session');
  assert.ok(!calls[0].argv.some((arg) => arg.includes('review concurrency')), 'transcript must not be exposed in argv');
  assert.match(calls[0].stdin, /review concurrency/, 'prompt should be delivered over stdin');

  const state = readState(sessionId);
  assert.equal(state.focus, 'race-safe focus');
  assert.equal(state.promptCount, 2);
  assert.equal(state.lastUserPrompt, 'newer prompt');
  assert.equal(state.cwd, '/new/cwd');
});
