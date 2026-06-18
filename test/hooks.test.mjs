import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const REFINING_ENV_VAR = 'CLAUDE_RECALL_REFINING';

function runHook(relativePath, stdin, extraEnv = {}) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-hook-test-'));
  const child = spawn(process.execPath, [join(ROOT, relativePath)], {
    env: {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
  child.stdin.end(stdin);

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        // best effort
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function runHookWithHome(relativePath, stdin, extraEnv = {}) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-hook-test-'));
  const child = spawn(process.execPath, [join(ROOT, relativePath)], {
    env: {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
  child.stdin.end(stdin);

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, tmpHome });
    });
  });
}

test('trigger-refinement hook: malformed stdin still returns an empty hook response', async () => {
  const result = await runHook('dist/hooks/trigger-refinement.js', 'not json');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, '');
});

test('trigger-refinement hook: PostCompact compact_summary works without transcript_path', async () => {
  const result = await runHook(
    'dist/hooks/trigger-refinement.js',
    JSON.stringify({ session_id: 'missing-state', compact_summary: 'Preserve release prep context.' }),
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, '');
});

test('prompt-submit hook: missing session_id is a no-op response', async () => {
  const result = await runHook('dist/hooks/prompt-submit.js', '{"user_prompt":"hello"}');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, '');
});

test('session-start hook: refinement subprocess env skips hook work before parsing stdin', async () => {
  const result = await runHook(
    'dist/hooks/session-start.js',
    'not json',
    { [REFINING_ENV_VAR]: '1' },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, '');
});

test('cwd-changed hook: persists current cwd from new_cwd', async () => {
  const result = await runHookWithHome(
    'dist/hooks/cwd-changed.js',
    JSON.stringify({
      session_id: 'cwd-session',
      cwd: '/tmp/old-cwd',
      new_cwd: ROOT,
    }),
  );

  try {
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '{}\n');
    assert.equal(result.stderr, '');

    const statePath = join(result.tmpHome, '.claude', 'claude-recall', 'sessions', 'cwd-session.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(state.cwd, ROOT);
    assert.equal(state.sessionId, 'cwd-session');
    assert.equal(typeof state.lastActivityAt, 'string');
  } finally {
    rmSync(result.tmpHome, { recursive: true, force: true });
  }
});

test('cwd-changed hook: clears stale git status when new cwd is not a git repo', async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-hook-test-'));
  const nonGitDir = mkdtempSync(join(tmpdir(), 'claude-recall-nongit-'));
  const stateDir = join(tmpHome, '.claude', 'claude-recall', 'sessions');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'cwd-session.json'), JSON.stringify({
    sessionId: 'cwd-session',
    focus: '',
    branch: 'stale-branch',
    gitStatus: {
      branch: 'stale-branch',
      dirty: false,
      ahead: 0,
      behind: 0,
      defaultBranch: 'main',
    },
    cwd: ROOT,
    promptCount: 0,
    lastUserPrompt: '',
    sessionStartedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    lastRefinedAt: null,
    refinementError: null,
    lastRefinement: null,
  }));

  const child = spawn(process.execPath, [join(ROOT, 'dist/hooks/cwd-changed.js')], {
    env: {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
  child.stdin.end(JSON.stringify({
    session_id: 'cwd-session',
    cwd: ROOT,
    new_cwd: nonGitDir,
  }));

  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    assert.equal(code, 0);
    assert.equal(stdout, '{}\n');
    assert.equal(stderr, '');

    const state = JSON.parse(readFileSync(join(stateDir, 'cwd-session.json'), 'utf-8'));
    assert.equal(state.cwd, nonGitDir);
    assert.equal(state.gitStatus, null);
    assert.equal(state.branch, '');
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(nonGitDir, { recursive: true, force: true });
  }
});
