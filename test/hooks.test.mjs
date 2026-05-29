import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('trigger-refinement hook: malformed stdin still returns an empty hook response', async () => {
  const result = await runHook('dist/hooks/trigger-refinement.js', 'not json');
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
