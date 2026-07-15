import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const { withFileLock } = await import('../dist/json-file.js');

function claimPath(target, token) {
  const key = createHash('sha256').update(target).digest('hex');
  return join(dirname(target), '.locks', `${key}.${token}.json`);
}

test('withFileLock: a fresh lock from a dead owner is recovered immediately', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-recall-dead-lock-'));
  const target = join(dir, 'state.json');
  const lockDir = join(dir, '.locks');
  mkdirSync(lockDir);
  writeFileSync(claimPath(target, 'dead-owner'), JSON.stringify({
    token: 'dead-owner',
    pid: 2_147_483_647,
    createdAt: Date.now(),
    choosing: false,
    ticket: 1,
  }));
  try {
    let entered = false;
    const started = Date.now();
    await withFileLock(target, () => { entered = true; }, { timeoutMs: 1_000 });
    assert.equal(entered, true);
    assert.ok(Date.now() - started < 1_000, 'dead-owner recovery should not wait for the mtime lease');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withFileLock: stale mtime never permits stealing from a live owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-recall-live-lock-'));
  const target = join(dir, 'state.json');
  const marker = join(dir, 'entered');
  const moduleUrl = pathToFileURL(join(ROOT, 'dist', 'json-file.js')).href;
  const script = `
    import { writeFileSync } from 'node:fs';
    import { withFileLock } from ${JSON.stringify(moduleUrl)};
    await withFileLock(process.argv[1], () => {
      writeFileSync(process.argv[2], 'entered');
      const until = Date.now() + 1500;
      while (Date.now() < until) {}
    });
  `;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', script, target, marker], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let ownerStderr = '';
  owner.stderr.on('data', (chunk) => { ownerStderr += chunk.toString('utf-8'); });

  try {
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(marker), true, `owner failed to acquire lock: ${ownerStderr}`);
    const lockDir = join(dir, '.locks');
    const activeClaim = join(lockDir, readdirSync(lockDir).find((name) => name.endsWith('.json')));
    const old = new Date(Date.now() - 120_000);
    utimesSync(activeClaim, old, old);

    let contenderEntered = false;
    await assert.rejects(
      withFileLock(target, () => { contenderEntered = true; }, { timeoutMs: 200 }),
      /Timed out waiting for file lock/,
    );
    assert.equal(contenderEntered, false);

    const ownerCode = await new Promise((resolve, reject) => {
      owner.once('error', reject);
      owner.once('close', resolve);
    });
    assert.equal(ownerCode, 0, ownerStderr);
    await withFileLock(target, () => { contenderEntered = true; }, { timeoutMs: 1_000 });
    assert.equal(contenderEntered, true);
  } finally {
    if (owner.exitCode === null) owner.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withFileLock: concurrent recovery from one dead claim keeps RMW serialized', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-recall-dead-lock-race-'));
  const target = join(dir, 'counter.json');
  const lockDir = join(dir, '.locks');
  const moduleUrl = pathToFileURL(join(ROOT, 'dist', 'json-file.js')).href;
  mkdirSync(lockDir);
  writeFileSync(target, JSON.stringify({ count: 0 }));
  writeFileSync(claimPath(target, 'dead-generation'), JSON.stringify({
    token: 'dead-generation',
    pid: 2_147_483_647,
    createdAt: Date.now(),
    choosing: false,
    ticket: 1,
  }));
  const script = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { withFileLock } from ${JSON.stringify(moduleUrl)};
    await withFileLock(process.argv[1], () => {
      const value = JSON.parse(readFileSync(process.argv[1], 'utf-8'));
      const until = Date.now() + 60;
      while (Date.now() < until) {}
      writeFileSync(process.argv[1], JSON.stringify({ count: value.count + 1 }));
    });
  `;

  try {
    const children = Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, target], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `lock contender exited ${code}`));
      });
    }));
    await Promise.all(children);
    assert.equal(JSON.parse(readFileSync(target, 'utf-8')).count, children.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
