import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
const PLUGIN_KEY = 'claude-recall@claude-recall';
const SCOPE_PRIORITY = {
    managed: 4,
    local: 3,
    project: 2,
    user: 1,
};
function resolveConfiguredDir(configured) {
    if (configured === '~')
        return homedir();
    if (configured.startsWith('~/') || configured.startsWith('~\\')) {
        return join(homedir(), configured.slice(2));
    }
    return isAbsolute(configured) ? configured : resolve(configured);
}
function configDir() {
    const configured = process.env['CLAUDE_CONFIG_DIR']?.trim();
    return configured ? resolveConfiguredDir(configured) : join(homedir(), '.claude');
}
function pluginsDir() {
    const configured = process.env['CLAUDE_CODE_PLUGIN_CACHE_DIR']?.trim();
    // Despite its legacy name, this variable points at the plugins root (the
    // parent of cache/, marketplaces/, and installed_plugins.json).
    return configured ? resolveConfiguredDir(configured) : join(configDir(), 'plugins');
}
function statuslineAt(root) {
    if (!root)
        return undefined;
    const candidate = join(root, 'dist', 'statusline.js');
    return existsSync(candidate) ? candidate : undefined;
}
function pathContains(base, candidate) {
    const rel = relative(resolve(base), resolve(candidate));
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}
function appliesToProject(entry, projectPaths) {
    if (entry.scope !== 'local' && entry.scope !== 'project')
        return true;
    return typeof entry.projectPath === 'string'
        && projectPaths.some((path) => pathContains(entry.projectPath, path));
}
function installedStatusline(projectPaths) {
    try {
        const registryPath = join(pluginsDir(), 'installed_plugins.json');
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        const entries = registry.plugins?.[PLUGIN_KEY];
        if (!Array.isArray(entries))
            return undefined;
        const sorted = entries.filter((entry) => appliesToProject(entry, projectPaths)).sort((a, b) => {
            const scope = (SCOPE_PRIORITY[b.scope ?? ''] ?? 0) - (SCOPE_PRIORITY[a.scope ?? ''] ?? 0);
            if (scope !== 0)
                return scope;
            return Date.parse(b.lastUpdated ?? '') - Date.parse(a.lastUpdated ?? '');
        });
        for (const entry of sorted) {
            const path = statuslineAt(entry.installPath);
            if (path)
                return path;
        }
    }
    catch {
        // Fall through to the setup-time plugin root for --plugin-dir development.
    }
    return undefined;
}
function readInput() {
    return new Promise((resolveInput) => {
        let raw = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => { raw += chunk; });
        process.stdin.on('end', () => resolveInput(raw));
        process.stdin.on('error', () => resolveInput(raw));
    });
}
function projectPathsFromInput(raw) {
    try {
        const input = JSON.parse(raw);
        const workspace = input['workspace'];
        if (workspace && typeof workspace === 'object' && !Array.isArray(workspace)) {
            const fields = workspace;
            // Without a hook-recorded scope, use the current /cd destination.
            if (typeof fields['current_dir'] === 'string' && fields['current_dir'])
                return [fields['current_dir']];
            if (typeof input['cwd'] === 'string' && input['cwd'])
                return [input['cwd']];
            if (typeof fields['project_dir'] === 'string' && fields['project_dir'])
                return [fields['project_dir']];
            return [process.cwd()];
        }
        return typeof input['cwd'] === 'string' && input['cwd']
            ? [input['cwd']]
            : [process.cwd()];
    }
    catch { /* user/managed entries and setup fallback remain available */ }
    return [process.cwd()];
}
function activeStatusline(raw) {
    try {
        const id = JSON.parse(raw)?.session_id;
        if (typeof id !== 'string' || !id)
            return { known: false };
        const stem = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)
            ? id : `session-${createHash('sha256').update(id).digest('hex')}`;
        const state = JSON.parse(readFileSync(join(configDir(), 'claude-recall', 'sessions', `${stem}.json`), 'utf8'));
        if (typeof state.activePluginRoot === 'string') {
            return { known: true, path: isAbsolute(state.activePluginRoot) ? statuslineAt(state.activePluginRoot) : undefined };
        }
    }
    catch { /* first render can precede SessionStart */ }
    return { known: false };
}
function developmentStatusline(root) {
    if (!root)
        return undefined;
    try {
        const registry = JSON.parse(readFileSync(join(pluginsDir(), 'installed_plugins.json'), 'utf8'));
        // A setup root absent from the registry is an explicit local development
        // installation. Recorded hooks take precedence, including managed plugins.
        const installed = Object.values(registry.plugins ?? {}).flat();
        if (installed.some((entry) => entry.installPath && resolve(entry.installPath) === resolve(root)))
            return undefined;
        if (pathContains(pluginsDir(), root))
            return undefined;
    }
    catch { /* no registry: explicit setup root remains usable */ }
    return statuslineAt(root);
}
async function main() {
    const raw = await readInput();
    const active = activeStatusline(raw);
    const statusline = active.known ? active.path
        : developmentStatusline(process.argv[2]) ?? installedStatusline(projectPathsFromInput(raw)) ?? statuslineAt(process.argv[2]);
    if (!statusline)
        return;
    try {
        const child = spawn(process.execPath, [statusline], {
            env: process.env,
            stdio: ['pipe', 'inherit', 'inherit'],
        });
        child.stdin.on('error', () => { });
        child.stdin.end(raw);
        child.once('error', () => process.exit(0));
        child.once('close', () => process.exit(0));
    }
    catch {
        process.exit(0);
    }
}
void main();
