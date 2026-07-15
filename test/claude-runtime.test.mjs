import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

async function runtimeModule() {
  return import('../dist/claude-runtime.js');
}

function restoreConfigDir() {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
}

test('runtime pin is private, absolute, and does not consult a poisoned PATH', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-pin-'));
  const configDir = join(root, 'config');
  const fakeDir = join(root, 'fake-bin');
  mkdirSync(fakeDir, { recursive: true });
  const fakeClaude = join(fakeDir, process.platform === 'win32' ? 'claude.exe' : 'claude');
  writeFileSync(fakeClaude, '#!/bin/sh\necho fake\n');
  if (process.platform !== 'win32') chmodSync(fakeClaude, 0o755);
  process.env.CLAUDE_CONFIG_DIR = configDir;

  try {
    const {
      getClaudeRuntimeConfigPath,
      readClaudeRuntimeConfig,
      resolvePinnedClaudeExecutable,
      writeClaudeRuntimeConfig,
    } = await runtimeModule();
    const oldPath = process.env.PATH;
    process.env.PATH = `${fakeDir}${delimiter}${oldPath ?? ''}`;
    try {
      assert.equal(resolvePinnedClaudeExecutable(), null, 'PATH must never be a runtime fallback');
      writeClaudeRuntimeConfig({ path: process.execPath, version: 'test-version' });
      assert.equal(resolvePinnedClaudeExecutable(), resolve(process.execPath));
      assert.equal(readClaudeRuntimeConfig().claudeExecutable, resolve(process.execPath));
      const mode = (await import('node:fs')).statSync(getClaudeRuntimeConfigPath()).mode & 0o777;
      if (process.platform !== 'win32') assert.equal(mode, 0o600);
    } finally {
      process.env.PATH = oldPath;
    }
  } finally {
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('refinement fails closed without a pin and never launches a PATH candidate', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX fake PATH fixture');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-fail-closed-'));
  const configDir = join(root, 'config');
  const fakeDir = join(root, 'fake-bin');
  const marker = join(root, 'path-candidate-ran');
  const fakeClaude = join(fakeDir, 'claude');
  mkdirSync(fakeDir, { recursive: true });
  writeFileSync(fakeClaude, `#!/bin/sh\ntouch "${marker}"\necho fake\n`);
  chmodSync(fakeClaude, 0o755);
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeDir}${delimiter}${oldPath ?? ''}`;
  try {
    const { spawnRefinement } = await import('../dist/refine.js');
    const result = await spawnRefinement('User: verify fail closed', '');
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'setup_required');
    assert.equal(existsSync(marker), false);
  } finally {
    process.env.PATH = oldPath;
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('verified pin resolution uses the absolute descriptor even when PATH is poisoned', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX fake PATH fixture');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-pinned-spawn-'));
  const configDir = join(root, 'config');
  const fakeDir = join(root, 'fake-bin');
  const marker = join(root, 'path-candidate-ran');
  const fakeClaude = join(fakeDir, 'claude');
  mkdirSync(fakeDir, { recursive: true });
  writeFileSync(fakeClaude, `#!/bin/sh\ntouch "${marker}"\necho fake\n`);
  chmodSync(fakeClaude, 0o755);
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeDir}${delimiter}${oldPath ?? ''}`;
  try {
    const { resolveVerifiedPinnedClaudeExecutable, writeClaudeRuntimeConfig } = await runtimeModule();
    writeClaudeRuntimeConfig({ path: process.execPath, version: 'test-node-binary' });
    const resolved = await resolveVerifiedPinnedClaudeExecutable(async () => 'test-version');
    assert.equal(resolved, (await import('node:fs')).realpathSync(process.execPath));
    assert.equal(existsSync(marker), false);
  } finally {
    process.env.PATH = oldPath;
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('verified resolution returns the captured target even if the stable symlink retargets mid-check', async (t) => {
  if (process.platform === 'win32') return t.skip('symlink semantics differ on Windows CI');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-snapshot-'));
  const configDir = join(root, 'config');
  const stable = join(root, 'claude');
  process.env.CLAUDE_CONFIG_DIR = configDir;
  symlinkSync(process.execPath, stable);
  try {
    const { realpathSync } = await import('node:fs');
    const { resolveVerifiedPinnedClaudeExecutable, writeClaudeRuntimeConfig } = await runtimeModule();
    writeClaudeRuntimeConfig({ path: stable, version: '1.0.0' });
    const originalTarget = realpathSync(stable);
    const resolved = await resolveVerifiedPinnedClaudeExecutable(async (capturedTarget) => {
      assert.equal(capturedTarget, originalTarget);
      unlinkSync(stable);
      symlinkSync('/bin/ls', stable);
      return '1.0.0';
    });
    assert.equal(resolved, originalTarget);
    assert.notEqual(realpathSync(stable), resolved);
  } finally {
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime validation rejects relative, missing, and shebang executables', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-invalid-'));
  const script = join(root, 'claude');
  writeFileSync(script, '#!/bin/sh\necho "2.1.0 (Claude Code)"\n');
  chmodSync(script, 0o755);
  try {
    const { isUsableClaudeExecutable } = await runtimeModule();
    assert.equal(isUsableClaudeExecutable('claude'), false);
    assert.equal(isUsableClaudeExecutable(join(root, 'missing')), false);
    assert.equal(isUsableClaudeExecutable(script), false, 'shebang would reintroduce PATH through /usr/bin/env');
    assert.equal(isUsableClaudeExecutable(process.execPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stable symlink stays lexical but a non-Claude retarget fails runtime verification', async (t) => {
  if (process.platform === 'win32') return t.skip('symlink semantics differ on Windows CI');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-symlink-'));
  const configDir = join(root, 'config');
  const stable = join(root, 'claude');
  process.env.CLAUDE_CONFIG_DIR = configDir;
  symlinkSync(process.execPath, stable);
  try {
    const {
      readClaudeRuntimeConfig,
      resolvePinnedClaudeExecutable,
      resolveVerifiedPinnedClaudeExecutable,
      writeClaudeRuntimeConfig,
    } = await runtimeModule();
    writeClaudeRuntimeConfig({ path: stable, version: '1.0.0' });
    const before = readClaudeRuntimeConfig();
    assert.equal(resolvePinnedClaudeExecutable(), stable);
    unlinkSync(stable);
    symlinkSync('/bin/ls', stable);
    assert.equal(resolvePinnedClaudeExecutable(), stable);
    assert.equal(await resolveVerifiedPinnedClaudeExecutable(), null);
    assert.deepEqual(readClaudeRuntimeConfig(), before, 'pin must retain the stable lexical path');
  } finally {
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('setup discovery never scans PATH and requires explicit non-default selection', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX symlink fixture');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-runtime-discovery-'));
  const project = join(root, 'project');
  const trusted = join(root, 'trusted');
  mkdirSync(project, { recursive: true });
  mkdirSync(trusted, { recursive: true });
  const projectClaude = join(project, 'claude');
  const trustedClaude = join(trusted, 'claude');
  symlinkSync(process.execPath, projectClaude);
  symlinkSync(process.execPath, trustedClaude);
  const verified = [];
  try {
    const { discoverClaudeExecutables } = await runtimeModule();
    const ignoredPathCandidates = await discoverClaudeExecutables({
      homeDir: join(root, 'home-without-native'),
      projectDir: project,
      tempDir: join(root, 'different-temp-root'),
      verifyVersion: async (path) => {
        verified.push(path);
        return '2.1.0';
      },
    });
    assert.deepEqual(ignoredPathCandidates, []);
    assert.deepEqual(verified, []);

    const candidates = await discoverClaudeExecutables({
      explicitPath: trustedClaude,
      homeDir: join(root, 'home-without-native'),
      projectDir: project,
      tempDir: join(root, 'different-temp-root'),
      verifyVersion: async (path) => {
        verified.push(path);
        return '2.1.0';
      },
    });
    assert.deepEqual(candidates, [{ path: trustedClaude, version: '2.1.0' }]);
    assert.deepEqual(verified, [trustedClaude]);

    const rejectedProjectCandidate = await discoverClaudeExecutables({
      explicitPath: projectClaude,
      homeDir: join(root, 'home-without-native'),
      projectDir: project,
      tempDir: join(root, 'different-temp-root'),
      verifyVersion: async () => '2.1.0',
    });
    assert.deepEqual(rejectedProjectCandidate, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
