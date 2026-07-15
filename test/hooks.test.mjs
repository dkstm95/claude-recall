import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const ROOT = process.cwd();
const REFINING_ENV_VAR = 'CLAUDE_RECALL_REFINING';

function isolatedEnv(tmpHome, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    ...extraEnv,
  };
  if (!Object.hasOwn(extraEnv, 'CLAUDE_CONFIG_DIR')) delete env.CLAUDE_CONFIG_DIR;
  return env;
}

function runHook(relativePath, stdin, extraEnv = {}) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-hook-test-'));
  const child = spawn(process.execPath, [join(ROOT, relativePath)], {
    env: isolatedEnv(tmpHome, extraEnv),
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
    env: isolatedEnv(tmpHome, extraEnv),
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

function runHookInHome(relativePath, stdin, tmpHome, extraEnv = {}) {
  const child = spawn(process.execPath, [join(ROOT, relativePath)], {
    env: isolatedEnv(tmpHome, extraEnv),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
  child.stdin.end(stdin);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
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

test('prompt-submit hook: slash commands emit exactly one JSON response', async () => {
  const result = await runHook('dist/hooks/prompt-submit.js', JSON.stringify({
    session_id: 'slash-session',
    cwd: ROOT,
    user_prompt: '/clear',
  }));
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, '');
});

test('prompt-submit hook: concurrent writers preserve every prompt increment', async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-hook-race-'));
  const nonGitDir = mkdtempSync(join(tmpdir(), 'claude-recall-hook-race-cwd-'));
  const count = 24;
  try {
    const results = await Promise.all(Array.from({ length: count }, (_, i) => runHookInHome(
      'dist/hooks/prompt-submit.js',
      JSON.stringify({ session_id: 'shared-session', cwd: nonGitDir, user_prompt: `prompt ${i}` }),
      tmpHome,
    )));
    for (const result of results) {
      assert.equal(result.code, 0);
      assert.equal(result.stdout, '{}\n');
      assert.equal(result.stderr, '');
    }
    const statePath = join(tmpHome, '.claude', 'claude-recall', 'sessions', 'shared-session.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(state.promptCount, count);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(nonGitDir, { recursive: true, force: true });
  }
});

test('prompt-submit hook: unsafe session ids stay inside the private state directory', async () => {
  const result = await runHookWithHome(
    'dist/hooks/prompt-submit.js',
    JSON.stringify({ session_id: '../../settings', cwd: ROOT, user_prompt: 'hello' }),
  );
  try {
    const recallDir = join(result.tmpHome, '.claude', 'claude-recall');
    const stateDir = join(recallDir, 'sessions');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '{}\n');
    assert.equal(existsSync(join(result.tmpHome, '.claude', 'settings.json')), false);
    const stateFiles = readdirSync(stateDir).filter((name) => name.endsWith('.json'));
    assert.equal(stateFiles.length, 1);
    assert.match(stateFiles[0], /^session-[a-f0-9]{64}\.json$/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(recallDir).mode & 0o777, 0o700);
      assert.equal(statSync(stateDir).mode & 0o777, 0o700);
      assert.equal(statSync(join(stateDir, stateFiles[0])).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(result.tmpHome, { recursive: true, force: true });
  }
});

test('prompt-submit hook: CLAUDE_CONFIG_DIR owns plugin state', async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-config-home-'));
  const configDir = join(tmpHome, 'custom-config');
  try {
    const result = await runHookInHome(
      'dist/hooks/prompt-submit.js',
      JSON.stringify({ session_id: 'custom-config-session', cwd: ROOT, user_prompt: 'hello' }),
      tmpHome,
      { CLAUDE_CONFIG_DIR: configDir },
    );
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '{}\n');
    assert.equal(
      existsSync(join(configDir, 'claude-recall', 'sessions', 'custom-config-session.json')),
      true,
    );
    assert.equal(existsSync(join(tmpHome, '.claude', 'claude-recall')), false);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
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

test('session-start hook: a concurrent newer prompt state is never reset or rolled back', async (t) => {
  if (process.platform === 'win32') return t.skip('fake executable fixture is POSIX-only');
  const tmpHome = mkdtempSync(join(tmpdir(), 'claude-recall-session-start-race-'));
  const binDir = join(tmpHome, 'bin');
  const fakeGit = join(binDir, 'git');
  const marker = join(tmpHome, 'git-started');
  const startupCwd = mkdtempSync(join(tmpdir(), 'claude-recall-startup-cwd-'));
  const promptCwd = mkdtempSync(join(tmpdir(), 'claude-recall-prompt-cwd-'));
  mkdirSync(binDir, { recursive: true });
  writeFileSync(fakeGit, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FAKE_GIT_MARKER, 'started');
setTimeout(() => process.exit(1), 400);
`);
  chmodSync(fakeGit, 0o755);

  try {
    const startup = runHookInHome(
      'dist/hooks/session-start.js',
      JSON.stringify({ session_id: 'startup-race', cwd: startupCwd, source: 'startup' }),
      tmpHome,
      {
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        FAKE_GIT_MARKER: marker,
      },
    );

    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(marker), true, 'SessionStart must reach git after taking its state snapshot');

    const prompt = await runHookInHome(
      'dist/hooks/prompt-submit.js',
      JSON.stringify({ session_id: 'startup-race', cwd: promptCwd, user_prompt: 'newer prompt' }),
      tmpHome,
    );
    const started = await startup;
    assert.equal(prompt.stderr, '');
    assert.equal(started.stderr, '');

    const statePath = join(tmpHome, '.claude', 'claude-recall', 'sessions', 'startup-race.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(state.promptCount, 1);
    assert.equal(state.lastUserPrompt, 'newer prompt');
    assert.equal(state.cwd, promptCwd);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(startupCwd, { recursive: true, force: true });
    rmSync(promptCwd, { recursive: true, force: true });
  }
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
