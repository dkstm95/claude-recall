import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { refinementArgs } from '../dist/refine.js';
import { assertSupportedClaudeVersion } from '../dist/setup.js';

// No model request: --init-only validates the real CLI contract and exits.
// Explicit absolute paths also work for Homebrew and CI-installed binaries.
const executable = process.argv[2] ?? join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
if (!isAbsolute(executable)) throw new Error('Pass an absolute Claude executable path');
const config = mkdtempSync(join(tmpdir(), 'recall-cli-contract-'));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(CLAUDE|ANTHROPIC)_/.test(key) || key === 'CLAUDECODE') delete env[key];
}
Object.assign(env, { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_RECALL_REFINING: '1' });
function run(args, input = '') {
  const result = spawnSync(executable, args, { cwd: config, env, input, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const versionOutput = run(['--version']).trim();
  const version = versionOutput.match(/\d+\.\d+\.\d+/)?.[0] ?? '';
  assertSupportedClaudeVersion(version);
  run([...refinementArgs(), '--init-only']);
  for (const root of [process.cwd(), join(process.cwd(), 'plugin')]) run(['plugin', 'validate', root]);
  process.stdout.write(`Claude ${version}: refinement options and both plugin manifests validated (no model request)\n`);
} finally { rmSync(config, { recursive: true, force: true }); }
