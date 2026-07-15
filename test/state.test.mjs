import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';

const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-state-test-'));
delete process.env.CLAUDE_CONFIG_DIR;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const {
  getGitStatus,
  getStateDir,
  getStatePath,
  readState,
} = await import('../dist/state.js');

test.after(() => rmSync(tmpHome, { recursive: true, force: true }));

test('getStatePath: unsafe session ids cannot escape the session directory', () => {
  const stateDir = getStateDir();
  const path = getStatePath('../../settings');
  assert.equal(dirname(path), stateDir);
  assert.ok(!relative(stateDir, path).startsWith('..'));
  assert.match(path, /session-[a-f0-9]{64}\.json$/);
});

test('readState: malformed field types degrade to safe defaults', () => {
  const path = getStatePath('malformed');
  writeFileSync(path, JSON.stringify({
    sessionId: 'malformed',
    focus: 42,
    promptCount: 'many',
    gitStatus: { branch: 7 },
    refinementError: { code: 'not-real' },
  }));
  const state = readState('malformed');
  assert.equal(state.focus, '');
  assert.equal(state.promptCount, 0);
  assert.equal(state.gitStatus, null);
  assert.equal(state.refinementError, null);
});

test('readState: setup_required refinement diagnostics survive parsing', () => {
  const path = getStatePath('setup-required');
  writeFileSync(path, JSON.stringify({
    sessionId: 'setup-required',
    refinementError: { code: 'setup_required', at: '2026-07-15T00:00:00.000Z' },
  }));
  const state = readState('setup-required');
  assert.equal(state.refinementError.code, 'setup_required');
});

test('getGitStatus: partial git failures preserve same-branch fallback fields', async (t) => {
  if (process.platform === 'win32') return t.skip('fake executable fixture is POSIX-only');
  const binDir = mkdtempSync(join(tmpdir(), 'claude-recall-fake-git-'));
  const fakeGit = join(binDir, 'git');
  const oldPath = process.env.PATH;
  writeFileSync(fakeGit, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) process.stdout.write('feature\\n');
else if (args[0] === 'symbolic-ref') process.stdout.write('origin/main\\n');
else process.exitCode = 2;
`);
  chmodSync(fakeGit, 0o755);
  process.env.PATH = `${binDir}${delimiter}${oldPath ?? ''}`;
  try {
    const fallback = {
      branch: 'feature', dirty: true, ahead: 2, behind: 1, defaultBranch: 'main',
    };
    assert.deepEqual(await getGitStatus(process.cwd(), fallback), fallback);
  } finally {
    process.env.PATH = oldPath;
    rmSync(binDir, { recursive: true, force: true });
  }
});
