import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

interface InstalledPlugin {
  scope?: string;
  projectPath?: string;
  installPath?: string;
  lastUpdated?: string;
}

interface InstalledPluginsFile {
  plugins?: Record<string, InstalledPlugin[]>;
}

const PLUGIN_KEY = 'claude-recall@claude-recall';
const SCOPE_PRIORITY: Record<string, number> = {
  managed: 4,
  local: 3,
  project: 2,
  user: 1,
};

function resolveConfiguredDir(configured: string): string {
  if (configured === '~') return homedir();
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return join(homedir(), configured.slice(2));
  }
  return isAbsolute(configured) ? configured : resolve(configured);
}

function configDir(): string {
  const configured = process.env['CLAUDE_CONFIG_DIR']?.trim();
  return configured ? resolveConfiguredDir(configured) : join(homedir(), '.claude');
}

function pluginsDir(): string {
  const configured = process.env['CLAUDE_CODE_PLUGIN_CACHE_DIR']?.trim();
  // Despite its legacy name, this variable points at the plugins root (the
  // parent of cache/, marketplaces/, and installed_plugins.json).
  return configured ? resolveConfiguredDir(configured) : join(configDir(), 'plugins');
}

function statuslineAt(root: string | undefined): string | undefined {
  if (!root) return undefined;
  const candidate = join(root, 'dist', 'statusline.js');
  return existsSync(candidate) ? candidate : undefined;
}

function pathContains(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function appliesToProject(entry: InstalledPlugin, projectPaths: readonly string[]): boolean {
  if (entry.scope !== 'local' && entry.scope !== 'project') return true;
  return typeof entry.projectPath === 'string'
    && projectPaths.some((path) => pathContains(entry.projectPath!, path));
}

function installedStatusline(projectPaths: readonly string[]): string | undefined {
  try {
    const registryPath = join(pluginsDir(), 'installed_plugins.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as InstalledPluginsFile;
    const entries = registry.plugins?.[PLUGIN_KEY];
    if (!Array.isArray(entries)) return undefined;
    const sorted = entries.filter((entry) => appliesToProject(entry, projectPaths)).sort((a, b) => {
      const scope = (SCOPE_PRIORITY[b.scope ?? ''] ?? 0) - (SCOPE_PRIORITY[a.scope ?? ''] ?? 0);
      if (scope !== 0) return scope;
      return Date.parse(b.lastUpdated ?? '') - Date.parse(a.lastUpdated ?? '');
    });
    for (const entry of sorted) {
      const path = statuslineAt(entry.installPath);
      if (path) return path;
    }
  } catch {
    // Fall through to the setup-time plugin root for --plugin-dir development.
  }
  return undefined;
}

function readInput(): Promise<string> {
  return new Promise((resolveInput) => {
    let raw = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => { raw += chunk; });
    process.stdin.on('end', () => resolveInput(raw));
    process.stdin.on('error', () => resolveInput(raw));
  });
}

function projectPathsFromInput(raw: string): string[] {
  try {
    const input = JSON.parse(raw) as Record<string, unknown>;
    const workspace = input['workspace'];
    if (workspace && typeof workspace === 'object' && !Array.isArray(workspace)) {
      const fields = workspace as Record<string, unknown>;
      // project_dir is the immutable launch root and therefore the scope that
      // Claude used to activate project/local plugins. A later /cd must not
      // activate a different project's registry entry in the launcher.
      if (typeof fields['project_dir'] === 'string' && fields['project_dir']) {
        return [fields['project_dir']];
      }
      const fallback = new Set<string>([process.cwd()]);
      if (typeof input['cwd'] === 'string' && input['cwd']) fallback.add(input['cwd']);
      if (typeof fields['current_dir'] === 'string' && fields['current_dir']) {
        fallback.add(fields['current_dir']);
      }
      return [...fallback];
    }
    return typeof input['cwd'] === 'string' && input['cwd']
      ? [input['cwd']]
      : [process.cwd()];
  } catch { /* user/managed entries and setup fallback remain available */ }
  return [process.cwd()];
}

async function main(): Promise<void> {
  const raw = await readInput();
  const statusline = installedStatusline(projectPathsFromInput(raw)) ?? statuslineAt(process.argv[2]);
  if (!statusline) return;

  try {
    const child = spawn(process.execPath, [statusline], {
      env: process.env,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.on('error', () => { /* child may exit before consuming stdin */ });
    child.stdin.end(raw);
    child.once('error', () => process.exit(0));
    child.once('close', () => process.exit(0));
  } catch {
    process.exit(0);
  }
}

void main();
