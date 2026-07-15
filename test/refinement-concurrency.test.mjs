import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

test('triggerFocusRefinement: concurrent claims run once and pass transcript through stdin', async (t) => {
  if (process.platform === 'win32') return t.skip('fake executable fixture is POSIX-only');

  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-refine-race-'));
  const binDir = join(tmpHome, 'bin');
  const fakeClaude = join(binDir, 'claude');
  const logPath = join(tmpHome, 'claude-invocations.jsonl');
  const oldPath = process.env.PATH;
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  const oldConfigDir = process.env.CLAUDE_CONFIG_DIR;

  mkdirSync(binDir, { recursive: true });
  writeFileSync(fakeClaude, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }) + '\\n');
  setTimeout(() => process.stdout.write('concurrent focus\\n'), 150);
});
`);
  chmodSync(fakeClaude, 0o755);

  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.PATH = `${binDir}${delimiter}${oldPath ?? ''}`;

  try {
    const { createEmptySessionState, readState, writeState } = await import('../dist/state.js');
    const { triggerFocusRefinement } = await import('../dist/refine.js');
    writeState('race-session', createEmptySessionState('race-session', process.cwd()));

    await Promise.all([
      triggerFocusRefinement('race-session', undefined, 'FIRST_PRIVATE_SUMMARY', { claudeExecutable: fakeClaude }),
      triggerFocusRefinement('race-session', undefined, 'SECOND_PRIVATE_SUMMARY', { claudeExecutable: fakeClaude }),
    ]);

    const invocations = readFileSync(logPath, 'utf-8').trim().split('\n').map(JSON.parse);
    assert.equal(invocations.length, 1, 'the in-flight claim must debounce concurrent workers');
    assert.ok(invocations[0].input.includes('PRIVATE_SUMMARY'));
    assert.ok(!invocations[0].args.some((arg) => arg.includes('PRIVATE_SUMMARY')), 'transcript leaked into argv');
    assert.deepEqual(
      invocations[0].args.slice(invocations[0].args.indexOf('--setting-sources'), invocations[0].args.indexOf('--setting-sources') + 2),
      ['--setting-sources', ''],
    );
    assert.deepEqual(
      invocations[0].args.slice(invocations[0].args.indexOf('--settings'), invocations[0].args.indexOf('--settings') + 2),
      ['--settings', '{"disableAllHooks":true}'],
    );
    assert.ok(invocations[0].args.includes('--strict-mcp-config'));
    assert.deepEqual(
      invocations[0].args.slice(invocations[0].args.indexOf('--mcp-config'), invocations[0].args.indexOf('--mcp-config') + 2),
      ['--mcp-config', '{}'],
    );
    assert.equal(realpathSync(invocations[0].cwd), realpathSync(join(tmpHome, '.claude', 'claude-recall')));
    const state = readState('race-session');
    assert.equal(state.focus, 'concurrent focus');
    assert.equal(state.refinementAttemptId, null);
  } finally {
    process.env.PATH = oldPath;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    if (oldConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = oldConfigDir;
    delete process.env.FAKE_CLAUDE_LOG;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});
