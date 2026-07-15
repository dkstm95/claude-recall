import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = join(ROOT, 'plugin');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

test('marketplace installs the dedicated runtime-only plugin root', () => {
  const marketplace = readJson(join(ROOT, '.claude-plugin', 'marketplace.json'));
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'claude-recall');
  assert.ok(entry);
  assert.equal(entry.source, './plugin');
  assert.deepEqual(
    readdirSync(PLUGIN_ROOT).sort(),
    ['.claude-plugin', 'LICENSE', 'commands', 'dist', 'hooks'],
  );

  for (const developmentEntry of [
    'node_modules',
    'package.json',
    'package-lock.json',
    'scripts',
    'src',
    'test',
    'tsconfig.json',
  ]) {
    assert.equal(existsSync(join(PLUGIN_ROOT, developmentEntry)), false, developmentEntry);
  }
});

test('runtime mirror retains ESM loading without a root npm package', async () => {
  assert.deepEqual(readJson(join(PLUGIN_ROOT, 'dist', 'package.json')), { type: 'module' });
  assert.equal(
    readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf-8'),
    readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf-8'),
  );
  assert.equal(
    readFileSync(join(PLUGIN_ROOT, 'LICENSE'), 'utf-8'),
    readFileSync(join(ROOT, 'LICENSE'), 'utf-8'),
  );

  const runtimeFormat = await import(pathToFileURL(join(PLUGIN_ROOT, 'dist', 'format.js')).href);
  assert.equal(typeof runtimeFormat.formatStatusline, 'function');
});

test('runtime and marketplace versions match the development package', () => {
  const packageVersion = readJson(join(ROOT, 'package.json')).version;
  const packageLock = readJson(join(ROOT, 'package-lock.json'));
  const pluginVersion = readJson(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version;
  const marketplace = readJson(join(ROOT, '.claude-plugin', 'marketplace.json'));
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'claude-recall');
  assert.equal(packageLock.version, packageVersion);
  assert.equal(packageLock.packages[''].version, packageVersion);
  assert.equal(pluginVersion, packageVersion);
  assert.equal(marketplace.metadata.version, packageVersion);
  assert.equal(entry.version, packageVersion);
});
