import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

function restoreConfigDir() {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
}

test('configureInstallation pins Claude and preserves unrelated settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-setup-'));
  const configDir = join(root, 'config with spaces');
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const settingsPath = join(configDir, 'settings.json');

  try {
    const { ensurePrivateDir } = await import('../dist/json-file.js');
    const { configureInstallation } = await import('../dist/setup.js');
    ensurePrivateDir(configDir);
    writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', env: { KEEP_ME: 'yes' } }));

    const result = configureInstallation(ROOT, { path: process.execPath, version: '9.9.9' });
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const runtime = JSON.parse(readFileSync(join(configDir, 'claude-recall', 'runtime.json'), 'utf-8'));

    assert.equal(settings.theme, 'dark');
    assert.deepEqual(settings.env, { KEEP_ME: 'yes' });
    assert.equal(settings.statusLine.type, 'command');
    assert.ok(settings.statusLine.command.startsWith('node '));
    assert.ok(settings.statusLine.command.includes('statusline-launcher.mjs'));
    assert.equal(settings.statusLine.padding, 1);
    assert.equal(settings.statusLine.refreshInterval, 30);
    assert.equal(runtime.claudeExecutable, resolve(process.execPath));
    assert.equal(runtime.verifiedVersion, '9.9.9');
    assert.equal(result.claudeExecutable, process.execPath);
    assert.equal(readFileSync(result.launcherPath).equals(readFileSync(join(ROOT, 'dist', 'launcher.js'))), true);
    if (process.platform !== 'win32') {
      assert.equal(statSync(result.launcherPath).mode & 0o777, 0o600);
      assert.equal(statSync(join(configDir, 'claude-recall', 'runtime.json')).mode & 0o777, 0o600);
    }
  } finally {
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows statusline command is valid in both Git Bash and PowerShell', async () => {
  const { buildStatusLineCommand } = await import('../dist/setup.js');
  const launcher = "C:\\Users\\O'Brien$(touch marker)`whoami`\\statusline-launcher.mjs";
  const pluginRoot = "C:\\Plugin $Root\\O'Brien";
  const command = buildStatusLineCommand(
    launcher,
    pluginRoot,
    'win32',
  );
  assert.match(command, /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
  const encoded = command.split(' ').at(-1);
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(script.includes("C:\\Users\\O''Brien$(touch marker)`whoami`\\statusline-launcher.mjs"));
  assert.ok(script.includes("C:\\Plugin $Root\\O''Brien"));
  assert.ok(script.includes('[Console]::InputEncoding = $utf8'));
  assert.ok(script.includes('[Console]::OutputEncoding = $utf8'));
});

test('Windows encoded command does not expose path substitutions to an outer Bash shell', async (t) => {
  if (process.platform === 'win32') return t.skip('outer Bash injection fixture');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-setup-win-command-'));
  const bin = join(root, 'bin');
  const marker = join(root, 'injected');
  const fakePowerShell = join(bin, 'powershell.exe');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(bin, { recursive: true });
  writeFileSync(fakePowerShell, '#!/bin/sh\nexit 0\n');
  chmodSync(fakePowerShell, 0o755);
  try {
    const { buildStatusLineCommand } = await import('../dist/setup.js');
    const command = buildStatusLineCommand(
      `C:\\Users\\foo$(touch ${marker})\\statusline-launcher.mjs`,
      'C:\\Plugin`touch another-marker`',
      'win32',
    );
    const result = spawnSync('/bin/bash', ['-c', command], {
      env: { ...process.env, PATH: bin },
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('configureInstallation refuses to overwrite malformed settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-setup-malformed-'));
  const configDir = join(root, 'config');
  const settingsPath = join(configDir, 'settings.json');
  process.env.CLAUDE_CONFIG_DIR = configDir;
  try {
    const { ensurePrivateDir } = await import('../dist/json-file.js');
    const { configureInstallation } = await import('../dist/setup.js');
    ensurePrivateDir(configDir);
    writeFileSync(settingsPath, '{ definitely not json');
    assert.throws(
      () => configureInstallation(ROOT, { path: process.execPath, version: '9.9.9' }),
      /Refusing to overwrite malformed settings JSON/,
    );
    assert.equal(readFileSync(settingsPath, 'utf-8'), '{ definitely not json');
    assert.equal(existsSync(join(configDir, 'claude-recall', 'runtime.json')), false);
    assert.equal(existsSync(join(configDir, 'claude-recall', 'statusline-launcher.mjs')), false);
  } finally {
    restoreConfigDir();
    rmSync(root, { recursive: true, force: true });
  }
});

test('setup CLI executes when its argv path contains a symlinked directory', (t) => {
  if (process.platform === 'win32') return t.skip('directory symlink fixture');
  const root = mkdtempSync(join(tmpdir(), 'claude-recall-setup-symlink-'));
  const linkedRoot = join(root, 'linked-plugin');
  symlinkSync(ROOT, linkedRoot, 'dir');
  try {
    const result = spawnSync(process.execPath, [join(linkedRoot, 'dist', 'setup.js'), '--invalid-argument'], {
      encoding: 'utf-8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown setup argument/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
