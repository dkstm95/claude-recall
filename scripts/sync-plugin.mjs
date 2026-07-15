import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..');
export const RUNTIME_PACKAGE_JSON = `${JSON.stringify({ type: 'module' }, null, 2)}\n`;

function relativeFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...relativeFiles(path, base));
    else if (entry.isFile()) files.push(relative(base, path));
    else throw new Error(`Unsupported runtime source entry: ${path}`);
  }
  return files.sort();
}

export function runtimeFileEntries(root = REPO_ROOT) {
  const entries = [
    { source: join(root, '.claude-plugin', 'plugin.json'), target: join('.claude-plugin', 'plugin.json') },
    { source: join(root, 'LICENSE'), target: 'LICENSE' },
  ];

  for (const directory of ['commands', 'hooks']) {
    const sourceRoot = join(root, directory);
    for (const file of relativeFiles(sourceRoot)) {
      entries.push({ source: join(sourceRoot, file), target: join(directory, file) });
    }
  }

  const distRoot = join(root, 'dist');
  for (const file of relativeFiles(distRoot).filter((path) => path.endsWith('.js'))) {
    entries.push({ source: join(distRoot, file), target: join('dist', file) });
  }

  return entries.sort((a, b) => a.target.localeCompare(b.target));
}

export function syncPlugin(root = REPO_ROOT) {
  const pluginRoot = join(root, 'plugin');
  const stagingRoot = mkdtempSync(join(root, '.plugin-sync-'));
  let installed = false;

  try {
    for (const { source, target } of runtimeFileEntries(root)) {
      const destination = join(stagingRoot, target);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }

    const runtimePackage = join(stagingRoot, 'dist', 'package.json');
    mkdirSync(dirname(runtimePackage), { recursive: true });
    writeFileSync(runtimePackage, RUNTIME_PACKAGE_JSON, { mode: 0o644 });

    rmSync(pluginRoot, { recursive: true, force: true });
    renameSync(stagingRoot, pluginRoot);
    installed = true;
    process.stdout.write(`plugin/ synced (${runtimeFileEntries(root).length + 1} files)\n`);
  } finally {
    if (!installed) rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function comparablePath(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

const invokedPath = process.argv[1] ? comparablePath(process.argv[1]) : '';
if (invokedPath === comparablePath(fileURLToPath(import.meta.url))) syncPlugin();
