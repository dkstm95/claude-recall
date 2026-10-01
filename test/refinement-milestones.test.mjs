import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { isolateProcess } from './helpers/environment.mjs';

const home = mkdtempSync(join(tmpdir(), 'recall-milestones-'));
isolateProcess(home);
const { createEmptySessionState, writeState, readState } = await import('../dist/state.js');
const { triggerFocusRefinement, spawnRefinement } = await import('../dist/refine.js');
process.on('exit', () => rmSync(home, { recursive: true, force: true }));

function fakeClaude(name, program) {
  const path = join(home, name);
  writeFileSync(path, '#!/usr/bin/env node\n' + program, { mode: 0o700 });
  return path;
}

test('milestones coalesce latest summary and survive an active refinement', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture');
  const log = join(home, 'runs.jsonl');
  const executable = fakeClaude('claude', `const fs = require('node:fs');
let input=''; process.stdin.on('data', c=>input+=c); process.stdin.on('end', ()=>{
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(input)+'\\n');
setTimeout(()=>process.stdout.write(input.includes('LATEST')?'latest focus':'old focus'), 300);
});`);
  const transcript = join(home, 'transcript');
  writeFileSync(transcript, 'BEFORE_COMPACTION');
  writeState('milestone', createEmptySessionState('milestone', home));
  const first = triggerFocusRefinement('milestone', transcript, undefined, { claudeExecutable: executable });
  const deadline = Date.now() + 10_000;
  while (!existsSync(log) && Date.now() < deadline) await delay(10);
  assert.ok(existsSync(log), 'first worker reached the CLI');
  const second = triggerFocusRefinement('milestone', transcript, 'INTERMEDIATE', { claudeExecutable: executable, milestone: true });
  await delay(20);
  const third = triggerFocusRefinement('milestone', transcript, 'LATEST', { claudeExecutable: executable, milestone: true });
  const end = triggerFocusRefinement('milestone', transcript, undefined, { claudeExecutable: executable, milestone: true });
  await Promise.all([first, second, third, end]);
  const invocations = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(invocations.length, 2);
  assert.match(invocations[1], /LATEST/);
  assert.doesNotMatch(invocations[1], /INTERMEDIATE/);
  assert.equal(readState('milestone').focus, 'latest focus');
  assert.equal(readState('milestone').pendingRefinement, undefined);
  assert.equal(readState('milestone').refinementAttemptId, null);
});

test('stdout errors are classified and retained without accepting them as focus', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture');
  for (const [message, expected] of [['Not logged in: 401', 'auth'], ['Rate limit 429', 'rate_limit']]) {
    const executable = fakeClaude('error-claude', `process.stdin.resume(); process.stdin.on('end',()=>{process.stdout.write(${JSON.stringify(message)});process.exitCode=1;});`);
    const result = await spawnRefinement('private transcript', '', { claudeExecutable: executable });
    assert.equal(result.status, 'error');
    assert.equal(result.code, expected);
    assert.match(result.stderrTail, new RegExp(message));
  }
});

test('an expired owner lease does not strand the persisted compaction summary', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture');
  const executable = fakeClaude('recovery-claude', `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(input.includes('RECOVER_ME')?'recovered focus':'wrong focus'));`);
  const state = createEmptySessionState('recovery', home);
  state.refinementAttemptId = 'crashed-owner';
  state.lastRefinedAt = new Date(Date.now() - 60_000).toISOString();
  state.pendingRefinement = { summary: 'RECOVER_ME' };
  writeState('recovery', state);
  await triggerFocusRefinement('recovery', undefined, undefined, { claudeExecutable: executable });
  assert.equal(readState('recovery').focus, 'recovered focus');
  assert.equal(readState('recovery').pendingRefinement, undefined);
});
