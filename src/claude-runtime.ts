import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePrivateDir, readJsonFile, writeJsonFileAtomic } from './json-file.js';
import { getRecallDir } from './paths.js';

const RUNTIME_SCHEMA_VERSION = 1;
const VERIFY_TIMEOUT_MS = 5_000;

export interface ClaudeRuntimeConfig {
  schemaVersion: 1;
  claudeExecutable: string;
  verifiedVersion: string;
  configuredAt: string;
}

export interface VerifiedClaudeExecutable {
  path: string;
  version: string;
}

export interface DiscoverClaudeOptions {
  explicitPath?: string;
  existingPath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  projectDir?: string;
  pluginRoot?: string;
  tempDir?: string;
  verifyVersion?: (path: string) => Promise<string | null>;
}

export function getClaudeRuntimeConfigPath(): string {
  return join(getRecallDir(), 'runtime.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readClaudeRuntimeConfig(): ClaudeRuntimeConfig | null {
  const value = readJsonFile<unknown>(getClaudeRuntimeConfigPath());
  if (!isRecord(value)) return null;
  if (
    value['schemaVersion'] !== RUNTIME_SCHEMA_VERSION
    || typeof value['claudeExecutable'] !== 'string'
    || !isAbsolute(value['claudeExecutable'])
    || typeof value['verifiedVersion'] !== 'string'
    || typeof value['configuredAt'] !== 'string'
  ) return null;
  return value as unknown as ClaudeRuntimeConfig;
}

export function writeClaudeRuntimeConfig(executable: VerifiedClaudeExecutable): ClaudeRuntimeConfig {
  if (!isAbsolute(executable.path)) throw new Error('Claude executable path must be absolute');
  const config: ClaudeRuntimeConfig = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    // Preserve the stable lexical launcher (usually a symlink). Storing its
    // version-specific realpath would stop following native/Homebrew updates.
    claudeExecutable: resolve(executable.path),
    verifiedVersion: executable.version,
    configuredAt: new Date().toISOString(),
  };
  writeJsonFileAtomic(getClaudeRuntimeConfigPath(), config);
  return config;
}

function pathContains(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function binaryMagic(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const bytes = Buffer.alloc(4);
    if (readSync(fd, bytes, 0, bytes.length, 0) < 2) return false;
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true; // ELF
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true; // PE/COFF
    const magic = bytes.readUInt32BE(0);
    return new Set([
      0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, // Mach-O
      0xcafebabe, 0xbebafeca, // universal Mach-O
      0xcafebabf, 0xbfbafeca, // 64-bit universal Mach-O
    ]).has(magic);
  } finally {
    closeSync(fd);
  }
}

/**
 * Validate a pinned executable without consulting PATH. Scripts are rejected:
 * a shebang such as `/usr/bin/env node` would merely move PATH trust one level
 * down. Official current Claude Code distributions use native binaries.
 */
export function isUsableClaudeExecutable(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!isAbsolute(path)) return false;
  if (platform === 'win32' && !path.toLowerCase().endsWith('.exe')) return false;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return binaryMagic(path);
  } catch {
    return false;
  }
}

export function resolvePinnedClaudeExecutable(): string | null {
  const config = readClaudeRuntimeConfig();
  if (!config || !isUsableClaudeExecutable(config.claudeExecutable)) return null;
  return config.claudeExecutable;
}

export async function resolveVerifiedPinnedClaudeExecutable(
  verify: (path: string) => Promise<string | null> = verifyClaudeExecutable,
): Promise<string | null> {
  const pinnedPath = resolvePinnedClaudeExecutable();
  if (!pinnedPath) return null;
  let targetSnapshot: string;
  try { targetSnapshot = realpathSync(pinnedPath); } catch { return null; }
  if (!isUsableClaudeExecutable(targetSnapshot)) return null;
  // Verify and return the same captured target, not the lexical symlink. A
  // concurrent updater may retarget the stable launcher for the next call, but
  // cannot swap a different executable between this verification and spawn.
  return await verify(targetSnapshot) ? targetSnapshot : null;
}

function candidateKey(path: string, platform: NodeJS.Platform): string {
  const normalized = resolve(path);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function nativeDefaultPath(options: DiscoverClaudeOptions): string {
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const executableName = platform === 'win32' ? 'claude.exe' : 'claude';
  return join(home, '.local', 'bin', executableName);
}

function candidatePaths(options: DiscoverClaudeOptions): string[] {
  const platform = options.platform ?? process.platform;
  const paths: string[] = [];
  if (options.explicitPath) paths.push(options.explicitPath);
  if (options.existingPath) paths.push(options.existingPath);
  // Deliberately do not scan PATH. Non-default package-manager installs must
  // be selected explicitly by the user during setup, so merely opening an
  // untrusted project can never cause a PATH candidate to be executed.
  paths.push(nativeDefaultPath(options));
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (!isAbsolute(path)) return false;
    const key = candidateKey(path, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isForbiddenAutoCandidate(path: string, options: DiscoverClaudeOptions): boolean {
  const alwaysForbidden = [
    options.pluginRoot,
    options.tempDir ?? tmpdir(),
  ].filter((root): root is string => !!root && isAbsolute(root));
  const isOfficialDefault = candidateKey(path, options.platform ?? process.platform)
    === candidateKey(nativeDefaultPath(options), options.platform ?? process.platform);
  const roots = isOfficialDefault || !options.projectDir || !isAbsolute(options.projectDir)
    ? alwaysForbidden
    : [...alwaysForbidden, options.projectDir];
  let target = path;
  try { target = realpathSync(path); } catch { /* usability check reports it */ }
  return roots.some((root) => {
    let realRoot = root;
    try { realRoot = realpathSync(root); } catch { /* lexical root remains useful */ }
    return [root, realRoot].some((base) => pathContains(base, path) || pathContains(base, target));
  });
}

export function verifyClaudeExecutable(path: string): Promise<string | null> {
  return new Promise((resolveVersion) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      ensurePrivateDir(getRecallDir());
      child = spawn(path, ['--version'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: getRecallDir(),
        env: process.env,
      });
    } catch {
      resolveVersion(null);
      return;
    }
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveVersion(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      finish(null);
    }, VERIFY_TIMEOUT_MS);
    timer.unref();
    child.stdout!.setEncoding('utf-8');
    child.stderr!.setEncoding('utf-8');
    child.stdout!.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(0, 1_000); });
    child.stderr!.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-1_000); });
    child.once('error', () => finish(null));
    child.once('close', (code) => {
      if (code !== 0) return finish(null);
      const output = `${stdout}\n${stderr}`;
      const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b[^\r\n]*\bClaude Code\b/i);
      finish(match?.[1] ?? null);
    });
  });
}

export async function discoverClaudeExecutables(
  options: DiscoverClaudeOptions = {},
): Promise<VerifiedClaudeExecutable[]> {
  const platform = options.platform ?? process.platform;
  const verified: VerifiedClaudeExecutable[] = [];
  for (const path of candidatePaths(options)) {
    if (isForbiddenAutoCandidate(path, options) || !isUsableClaudeExecutable(path, platform)) continue;
    const version = await (options.verifyVersion ?? verifyClaudeExecutable)(path);
    if (version) verified.push({ path: resolve(path), version });
  }
  return verified;
}

export function defaultPluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}
