import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const { withFileLock } = await import('../dist/json-file.js');

for (const scenario of ['transient', 'permanent', 'ticket']) {
  test(`atomic replacement: Windows ${scenario} sharing error`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'recall-rename-'));
    const moduleUrl = pathToFileURL(join(ROOT, 'dist', 'json-file.js')).href;
    const script = `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import { join } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const scenario = process.argv[2];
      const target = join(process.argv[1], 'state.json');
      fs.writeFileSync(target, 'original');
      const originalRename = fs.renameSync;
      let calls = 0;
      fs.renameSync = (source, destination) => {
        calls++;
        if (scenario === 'transient' && calls <= 2 || scenario === 'permanent'
          || scenario === 'ticket' && calls === 2) {
          if (scenario !== 'ticket') assert.equal(fs.readFileSync(target, 'utf8'), 'original');
          const err = new Error('injected sharing violation');
          err.code = scenario === 'ticket' ? 'EIO' : 'EPERM';
          throw err;
        }
        return originalRename(source, destination);
      };
      syncBuiltinESMExports();
      const { writeJsonFileAtomic, withFileLock } = await import(${JSON.stringify(moduleUrl)});
      const started = Date.now();
      if (scenario === 'transient') {
        writeJsonFileAtomic(target, { ok: true });
        assert.equal(calls, 3);
        assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true });
      } else if (scenario === 'permanent') {
        assert.throws(() => writeJsonFileAtomic(target, {}), { code: 'EPERM' });
        assert.ok(calls > 1);
        assert.ok(Date.now() - started < 3000);
        assert.equal(fs.readFileSync(target, 'utf8'), 'original');
      } else {
        await assert.rejects(withFileLock(target, () => assert.fail('must not enter')), { code: 'EIO' });
        assert.deepEqual(fs.readdirSync(join(process.argv[1], '.locks')), []);
      }
      assert.ok(!fs.readdirSync(process.argv[1]).some(name => name.includes('.tmp.')));
    `;
    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir, scenario], {
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

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
