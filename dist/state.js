import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
export function getStateDir() {
    const dir = join(homedir(), '.claude', 'claude-recall', 'sessions');
    mkdirSync(dir, { recursive: true });
    return dir;
}
export function getStatePath(sessionId) {
    return join(getStateDir(), `${sessionId}.json`);
}
export function readState(sessionId) {
    try {
        const raw = readFileSync(getStatePath(sessionId), 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed['focus'] === undefined && typeof parsed['purpose'] === 'string') {
            parsed['focus'] = parsed['purpose'];
        }
        return {
            sessionId: parsed['sessionId'] ?? sessionId,
            focus: parsed['focus'] ?? '',
            branch: parsed['branch'] ?? '',
            gitStatus: parsed['gitStatus'] ?? null,
            cwd: parsed['cwd'] ?? '',
            promptCount: parsed['promptCount'] ?? 0,
            lastUserPrompt: parsed['lastUserPrompt'] ?? '',
            lastActivityAt: parsed['lastActivityAt'] ?? new Date().toISOString(),
            lastRefinedAt: parsed['lastRefinedAt'] ?? null,
            refinementError: parsed['refinementError'] ?? null,
        };
    }
    catch {
        return null;
    }
}
export function writeState(sessionId, state) {
    const target = getStatePath(sessionId);
    const tmp = `${target}.tmp.${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    renameSync(tmp, target);
}
function runGit(cwd, args) {
    return execSync(`git ${args.join(' ')}`, {
        cwd,
        timeout: 2000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LC_ALL: 'C' },
    }).trim();
}
export function getGitStatus(cwd, fallback) {
    try {
        let branch = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        if (branch === 'HEAD') {
            try {
                branch = runGit(cwd, ['rev-parse', '--short', 'HEAD']);
            }
            catch { /* keep 'HEAD' */ }
        }
        let dirty = false;
        try {
            dirty = runGit(cwd, ['status', '--porcelain']).length > 0;
        }
        catch { /* treat as clean */ }
        let defaultBranch = 'main';
        try {
            const ref = runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
            defaultBranch = ref.replace(/^origin\//, '');
        }
        catch {
            try {
                runGit(cwd, ['rev-parse', '--verify', 'origin/master']);
                defaultBranch = 'master';
            }
            catch { /* keep 'main' guess */ }
        }
        let ahead = 0;
        let behind = 0;
        try {
            const out = runGit(cwd, ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`]);
            const parts = out.split(/\s+/).map((n) => parseInt(n, 10));
            behind = Number.isFinite(parts[0]) ? parts[0] : 0;
            ahead = Number.isFinite(parts[1]) ? parts[1] : 0;
        }
        catch { /* origin/<default> absent */ }
        return { branch, dirty, ahead, behind, defaultBranch };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('not a git repository'))
            return null;
        return fallback;
    }
}
const CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export function cleanupOldSessions() {
    const dir = getStateDir();
    const now = Date.now();
    let files;
    try {
        files = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const f of files) {
        if (!f.endsWith('.json') || f.includes('.tmp.'))
            continue;
        try {
            const raw = readFileSync(join(dir, f), 'utf-8');
            const state = JSON.parse(raw);
            const ts = new Date(state.lastActivityAt ?? 0).getTime();
            if (isNaN(ts) || now - ts > CLEANUP_MAX_AGE_MS) {
                unlinkSync(join(dir, f));
            }
        }
        catch {
            // skip
        }
    }
}
