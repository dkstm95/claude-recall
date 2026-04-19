import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { cleanupContextCache } from './context-window-cache.js';
const execFileAsync = promisify(execFile);
export function createEmptySessionState(sessionId, cwd) {
    const now = new Date().toISOString();
    return {
        sessionId,
        focus: '',
        branch: '',
        gitStatus: null,
        cwd,
        promptCount: 0,
        lastUserPrompt: '',
        sessionStartedAt: now,
        lastActivityAt: now,
        lastRefinedAt: null,
        refinementError: null,
        lastRefinement: null,
    };
}
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
        const lastActivityAt = parsed['lastActivityAt'] ?? new Date().toISOString();
        return {
            sessionId: parsed['sessionId'] ?? sessionId,
            focus: parsed['focus'] ?? '',
            branch: parsed['branch'] ?? '',
            gitStatus: parsed['gitStatus'] ?? null,
            cwd: parsed['cwd'] ?? '',
            promptCount: parsed['promptCount'] ?? 0,
            lastUserPrompt: parsed['lastUserPrompt'] ?? '',
            sessionStartedAt: parsed['sessionStartedAt'] ?? lastActivityAt,
            lastActivityAt,
            lastRefinedAt: parsed['lastRefinedAt'] ?? null,
            refinementError: parsed['refinementError'] ?? null,
            lastRefinement: parsed['lastRefinement'] ?? null,
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
async function runGit(cwd, args, timeoutMs = 1000) {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        timeout: timeoutMs,
        encoding: 'utf-8',
        env: { ...process.env, LC_ALL: 'C' },
    });
    return stdout.trim();
}
export async function refreshGitStatus(state, cwd) {
    const gitStatus = await getGitStatus(cwd, state.gitStatus);
    state.gitStatus = gitStatus;
    state.branch = gitStatus?.branch ?? state.branch;
}
// --no-optional-locks avoids blocking a concurrent user `git status`; callers
// (statusline + hooks) stay within their 1-10s budgets via the per-call timeout.
export async function getGitStatus(cwd, fallback) {
    try {
        const [branchR, dirtyR, defaultR] = await Promise.all([
            runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null),
            runGit(cwd, ['--no-optional-locks', 'status', '--porcelain']).catch(() => null),
            runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => null),
        ]);
        if (branchR === null)
            return fallback;
        let branch = branchR;
        if (branch === 'HEAD') {
            branch = await runGit(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => 'HEAD');
        }
        const dirty = dirtyR !== null && dirtyR.length > 0;
        let defaultBranch = 'main';
        if (defaultR) {
            defaultBranch = defaultR.replace(/^origin\//, '');
        }
        else {
            const master = await runGit(cwd, ['rev-parse', '--verify', 'origin/master']).catch(() => null);
            if (master !== null)
                defaultBranch = 'master';
        }
        let ahead = 0;
        let behind = 0;
        const revOut = await runGit(cwd, [
            'rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`,
        ]).catch(() => null);
        if (revOut) {
            const parts = revOut.split(/\s+/).map((n) => parseInt(n, 10));
            behind = Number.isFinite(parts[0]) ? parts[0] : 0;
            ahead = Number.isFinite(parts[1]) ? parts[1] : 0;
        }
        return { branch, dirty, ahead, behind, defaultBranch };
    }
    catch {
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
    const kept = new Set();
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
            else {
                kept.add(f.replace(/\.json$/, ''));
            }
        }
        catch {
            // skip
        }
    }
    cleanupContextCache(kept);
}
