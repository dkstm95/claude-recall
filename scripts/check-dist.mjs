import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_PACKAGE_JSON, runtimeFileEntries } from './sync-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempOut = mkdtempSync(join(tmpdir(), 'claude-recall-dist-check-'));

function relativeFiles(dir, base = dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...relativeFiles(path, base));
    else files.push(relative(base, path));
  }
  return files.sort();
}

function relativeJsFiles(dir) {
  return relativeFiles(dir).filter((path) => path.endsWith('.js'));
}

function checkRuntimeMirror() {
  const pluginRoot = join(root, 'plugin');
  const expected = new Map(runtimeFileEntries(root).map(({ source, target }) => [target, readFileSync(source)]));
  expected.set(join('dist', 'package.json'), Buffer.from(RUNTIME_PACKAGE_JSON));
  const actual = existsSync(pluginRoot) ? relativeFiles(pluginRoot) : [];
  const differences = [];

  for (const file of new Set([...expected.keys(), ...actual])) {
    if (!expected.has(file)) differences.push(`${file} (unexpected runtime file)`);
    else if (!actual.includes(file)) differences.push(`${file} (missing from runtime mirror)`);
    else if (!expected.get(file).equals(readFileSync(join(pluginRoot, file)))) {
      differences.push(`${file} (runtime mirror differs)`);
    }
  }

  if (differences.length > 0) {
    process.stderr.write(
      `plugin/ is stale; run npm run sync:plugin:\n${differences.map((d) => `- ${d}`).join('\n')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`plugin/ matches runtime sources (${expected.size} files)\n`);
  }
}

try {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const built = spawnSync(process.execPath, [tsc, '--outDir', tempOut], {
    cwd: root,
    encoding: 'utf-8',
  });
  if (built.status !== 0) {
    process.stderr.write(built.stdout ?? '');
    process.stderr.write(built.stderr ?? '');
    process.exitCode = built.status ?? 1;
  } else {
    const expected = relativeJsFiles(tempOut);
    const actual = relativeJsFiles(join(root, 'dist'));
    const differences = [];
    for (const file of new Set([...expected, ...actual])) {
      if (!expected.includes(file)) differences.push(`${file} (unexpected dist file)`);
      else if (!actual.includes(file)) differences.push(`${file} (missing from dist)`);
      else if (!readFileSync(join(tempOut, file)).equals(readFileSync(join(root, 'dist', file)))) {
        differences.push(`${file} (content differs)`);
      }
    }
    if (differences.length > 0) {
      process.stderr.write(`dist/ is stale; run npm run build:\n${differences.map((d) => `- ${d}`).join('\n')}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`dist/ matches src/ (${expected.length} files)\n`);
    }
    checkRuntimeMirror();
  }
} finally {
  rmSync(tempOut, { recursive: true, force: true });
}
