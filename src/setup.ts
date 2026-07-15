import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  defaultPluginRoot,
  discoverClaudeExecutables,
  readClaudeRuntimeConfig,
  writeClaudeRuntimeConfig,
  type VerifiedClaudeExecutable,
} from './claude-runtime.js';
import { ensurePrivateDir, writeJsonFileAtomic, writePrivateFileAtomic } from './json-file.js';
import { getClaudeConfigDir, getRecallDir } from './paths.js';

const REQUIRED_PLUGIN_FILES = [
  'hooks/hooks.json',
  'dist/statusline.js',
  'dist/hooks/session-start.js',
  'dist/hooks/prompt-submit.js',
  'dist/hooks/cwd-changed.js',
  'dist/hooks/trigger-refinement.js',
  'dist/launcher.js',
  'dist/setup.js',
] as const;

interface SetupOptions {
  claudeExecutable?: string;
  pluginRoot?: string;
}

export interface SetupResult {
  configDir: string;
  launcherPath: string;
  settingsPath: string;
  claudeExecutable: string;
  claudeVersion: string;
}

function parseArgs(args: string[]): SetupOptions {
  const options: SetupOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--claude-executable') {
      const value = args[index + 1];
      if (!value || !isAbsolute(value)) {
        throw new Error('--claude-executable requires an absolute path');
      }
      options.claudeExecutable = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown setup argument: ${arg}`);
  }
  return options;
}

function validatePluginRoot(pluginRoot: string): void {
  const missing = REQUIRED_PLUGIN_FILES.filter((path) => !existsSync(join(pluginRoot, path)));
  if (missing.length > 0) {
    throw new Error(`Plugin installation is incomplete; missing: ${missing.join(', ')}`);
  }
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    throw new Error(`Refusing to overwrite malformed settings JSON: ${path}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Claude settings must be a JSON object: ${path}`);
  }
  return value as Record<string, unknown>;
}

function commandArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function powershellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function windowsStatusLineCommand(launcherPath: string, pluginRoot: string): string {
  // The outer shell may be Git Bash or PowerShell. Keep every path out of that
  // shell entirely: EncodedCommand is ASCII-only, while the inner PowerShell
  // script uses literal single-quoted arguments and explicit UTF-8 stdio.
  const script = [
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    `& 'node' ${powershellArg(launcherPath)} ${powershellArg(pluginRoot)}`,
    'exit $LASTEXITCODE',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

export function buildStatusLineCommand(
  launcherPath: string,
  pluginRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') return windowsStatusLineCommand(launcherPath, pluginRoot);
  return `node ${commandArg(launcherPath)} ${commandArg(pluginRoot)}`;
}

export function configureInstallation(
  pluginRoot: string,
  executable: VerifiedClaudeExecutable,
): SetupResult {
  validatePluginRoot(pluginRoot);
  const configDir = getClaudeConfigDir();
  const recallDir = getRecallDir();
  const launcherPath = join(recallDir, 'statusline-launcher.mjs');
  const settingsPath = join(configDir, 'settings.json');
  const settings = readSettings(settingsPath);
  settings['statusLine'] = {
    type: 'command',
    command: buildStatusLineCommand(launcherPath, pluginRoot),
    padding: 1,
    refreshInterval: 30,
  };

  ensurePrivateDir(configDir);
  ensurePrivateDir(recallDir);
  writePrivateFileAtomic(launcherPath, readFileSync(join(pluginRoot, 'dist', 'launcher.js')));
  try { chmodSync(launcherPath, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  writeJsonFileAtomic(settingsPath, settings);
  // Commit the executable descriptor last. A failed settings write therefore
  // cannot make refinement appear configured while the launcher stayed stale.
  writeClaudeRuntimeConfig(executable);

  return {
    configDir,
    launcherPath,
    settingsPath,
    claudeExecutable: executable.path,
    claudeVersion: executable.version,
  };
}

async function chooseClaudeExecutable(options: SetupOptions, pluginRoot: string): Promise<VerifiedClaudeExecutable> {
  const existing = readClaudeRuntimeConfig();
  const cwd = process.cwd();
  const home = homedir();
  const projectDir = process.env['CLAUDE_PROJECT_DIR']
    ?? (resolve(cwd) === resolve(home) ? undefined : cwd);
  const candidates = await discoverClaudeExecutables({
    explicitPath: options.claudeExecutable,
    existingPath: existing?.claudeExecutable,
    projectDir,
    pluginRoot,
  });

  if (options.claudeExecutable) {
    const requested = resolve(options.claudeExecutable);
    const exact = candidates.find((candidate) => candidate.path === requested);
    if (!exact) {
      throw new Error(`The selected path is not a verified native Claude Code executable: ${requested}`);
    }
    return exact;
  }

  if (existing) {
    const pinned = candidates.find((candidate) => candidate.path === resolve(existing.claudeExecutable));
    if (pinned) return pinned;
  }

  if (candidates.length === 0) {
    throw new Error([
      'No verified native Claude Code executable was found.',
      'PATH is intentionally not searched. Install the current native Claude Code build,',
      'or explicitly choose a trusted package-manager launcher and rerun setup with:',
      '  /claude-recall:setup <absolute-path-to-claude>',
    ].join('\n'));
  }
  if (candidates.length > 1) {
    throw new Error([
      'Multiple Claude Code executables were found; choose the one this plugin should use:',
      ...candidates.map((candidate) => `  ${candidate.path} (${candidate.version})`),
      'Then rerun /claude-recall:setup with that absolute path.',
    ].join('\n'));
  }
  return candidates[0]!;
}

export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const pluginRoot = resolve(options.pluginRoot ?? defaultPluginRoot());
  validatePluginRoot(pluginRoot);
  const executable = await chooseClaudeExecutable(options, pluginRoot);
  return configureInstallation(pluginRoot, executable);
}

async function main(): Promise<void> {
  try {
    const result = await runSetup(parseArgs(process.argv.slice(2)));
    process.stdout.write([
      'claude-recall setup complete',
      `Claude executable: ${result.claudeExecutable} (${result.claudeVersion})`,
      `Runtime pin: ${join(result.configDir, 'claude-recall', 'runtime.json')}`,
      `Statusline launcher: ${result.launcherPath}`,
      `Settings: ${result.settingsPath}`,
      'Restart Claude Code to activate the updated launcher and hooks.',
    ].join('\n') + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`claude-recall setup failed: ${message}\n`);
    process.exitCode = 1;
  }
}

function comparablePath(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

const invokedPath = process.argv[1] ? comparablePath(process.argv[1]) : '';
if (invokedPath === comparablePath(fileURLToPath(import.meta.url))) void main();
