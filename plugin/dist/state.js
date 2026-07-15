import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cleanupContextCache } from './context-window-cache.js';
import { ensurePrivateDir, readJsonFile, withFileLock, writeJsonFileAtomic, } from './json-file.js';
import { getRecallDir } from './paths.js';
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
        refinementAttemptId: null,
        refinementError: null,
        lastRefinement: null,
    };
}
export function getStateDir() {
    const dir = join(getRecallDir(), 'sessions');
    ensurePrivateDir(getRecallDir());
    ensurePrivateDir(dir);
    return dir;
}
function stateFileStem(sessionId) {
    if (sessionId !== '.'
        && sessionId !== '..'
        && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId)) {
        return sessionId;
    }
    return `session-${createHash('sha256').update(sessionId).digest('hex')}`;
}
export function getStatePath(sessionId) {
    return join(getStateDir(), `${stateFileStem(sessionId)}.json`);
}
export function readState(sessionId) {
    const value = readJsonFile(getStatePath(sessionId));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const parsed = value;
    if (parsed['focus'] === undefined && typeof parsed['purpose'] === 'string') {
        parsed['focus'] = parsed['purpose'];
    }
    const stringValue = (key, fallback = '') => typeof parsed[key] === 'string' ? parsed[key] : fallback;
    const nullableString = (key) => typeof parsed[key] === 'string' ? parsed[key] : null;
    const count = parsed['promptCount'];
    const promptCount = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0;
    const lastActivityAt = stringValue('lastActivityAt', new Date().toISOString());
    const gitStatus = parseGitStatus(parsed['gitStatus']);
    const refinementError = parseRefinementError(parsed['refinementError']);
    const lastRefinement = parseLastRefinement(parsed['lastRefinement']);
    return {
        sessionId: stringValue('sessionId', sessionId),
        focus: stringValue('focus'),
        branch: stringValue('branch'),
        gitStatus,
        cwd: stringValue('cwd'),
        promptCount,
        lastUserPrompt: stringValue('lastUserPrompt'),
        sessionStartedAt: stringValue('sessionStartedAt', lastActivityAt),
        lastActivityAt,
        lastRefinedAt: nullableString('lastRefinedAt'),
        refinementAttemptId: nullableString('refinementAttemptId'),
        refinementError,
        lastRefinement,
    };
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function parseGitStatus(value) {
    if (!isRecord(value) || typeof value['branch'] !== 'string')
        return null;
    const ahead = finiteNumber(value['ahead']);
    const behind = finiteNumber(value['behind']);
    if (typeof value['dirty'] !== 'boolean'
        || ahead === undefined
        || behind === undefined
        || typeof value['defaultBranch'] !== 'string')
        return null;
    return {
        branch: value['branch'],
        dirty: value['dirty'],
        ahead: Math.max(0, Math.trunc(ahead)),
        behind: Math.max(0, Math.trunc(behind)),
        defaultBranch: value['defaultBranch'],
    };
}
const REFINEMENT_CODES = new Set([
    'timeout', 'rate_limit', 'auth', 'setup_required', 'unknown',
]);
function parseRefinementError(value) {
    if (!isRecord(value) || !REFINEMENT_CODES.has(value['code']))
        return null;
    return {
        code: value['code'],
        at: typeof value['at'] === 'string' ? value['at'] : new Date(0).toISOString(),
        durationMs: finiteNumber(value['durationMs']),
        stderrTail: typeof value['stderrTail'] === 'string' ? value['stderrTail'] : undefined,
    };
}
function parseLastRefinement(value) {
    if (!isRecord(value) || (value['status'] !== 'ok' && value['status'] !== 'error'))
        return null;
    const durationMs = finiteNumber(value['durationMs']);
    const transcriptBytes = finiteNumber(value['transcriptBytes']);
    if (durationMs === undefined || transcriptBytes === undefined)
        return null;
    const code = REFINEMENT_CODES.has(value['code'])
        ? value['code']
        : undefined;
    return {
        at: typeof value['at'] === 'string' ? value['at'] : new Date(0).toISOString(),
        status: value['status'],
        code,
        durationMs: Math.max(0, durationMs),
        transcriptBytes: Math.max(0, transcriptBytes),
        stdoutBytes: finiteNumber(value['stdoutBytes']),
        stderrTail: typeof value['stderrTail'] === 'string' ? value['stderrTail'] : undefined,
    };
}
export function writeState(sessionId, state) {
    writeJsonFileAtomic(getStatePath(sessionId), state);
}
/** Atomically read, mutate, and write one session without holding the lock across async work. */
export async function updateState(sessionId, updater) {
    const path = getStatePath(sessionId);
    return withFileLock(path, () => {
        const update = updater(readState(sessionId));
        if (update.state)
            writeState(sessionId, update.state);
        return update.value;
    });
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
export async function refreshGitStatus(state, cwd, options = {}) {
    const fallback = options.useFallback === false ? null : state.gitStatus;
    const gitStatus = await getGitStatus(cwd, fallback);
    applyGitStatus(state, gitStatus, options);
}
export function applyGitStatus(state, gitStatus, options = {}) {
    state.gitStatus = gitStatus;
    state.branch = gitStatus?.branch ?? (options.useFallback === false ? '' : state.branch);
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
        const sameBranchFallback = fallback?.branch === branch ? fallback : null;
        const dirty = dirtyR === null ? (sameBranchFallback?.dirty ?? false) : dirtyR.length > 0;
        let defaultBranch = 'main';
        if (defaultR) {
            defaultBranch = defaultR.replace(/^origin\//, '');
        }
        else {
            const [main, master] = await Promise.all([
                runGit(cwd, ['rev-parse', '--verify', 'origin/main']).catch(() => null),
                runGit(cwd, ['rev-parse', '--verify', 'origin/master']).catch(() => null),
            ]);
            if (main !== null)
                defaultBranch = 'main';
            else if (master !== null)
                defaultBranch = 'master';
            else if (sameBranchFallback?.defaultBranch)
                defaultBranch = sameBranchFallback.defaultBranch;
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
        else if (sameBranchFallback?.defaultBranch === defaultBranch) {
            ahead = sameBranchFallback.ahead;
            behind = sameBranchFallback.behind;
        }
        return { branch, dirty, ahead, behind, defaultBranch };
    }
    catch {
        return fallback;
    }
}
const CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export async function cleanupOldSessions() {
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
        const path = join(dir, f);
        try {
            const raw = readFileSync(path, 'utf-8');
            const state = JSON.parse(raw);
            const ts = new Date(state.lastActivityAt ?? 0).getTime();
            if (!isNaN(ts) && now - ts <= CLEANUP_MAX_AGE_MS) {
                kept.add(typeof state.sessionId === 'string' ? state.sessionId : f.replace(/\.json$/, ''));
                continue;
            }
            // Only stale candidates need serialization. Re-read after acquiring the
            // lock so a concurrently resumed session cannot be deleted from an old
            // pre-lock snapshot. Fresh sessions take no lock during lazy cleanup.
            const keptId = await withFileLock(path, () => {
                const freshRaw = readFileSync(path, 'utf-8');
                const fresh = JSON.parse(freshRaw);
                const freshTs = new Date(fresh.lastActivityAt ?? 0).getTime();
                if (isNaN(freshTs) || now - freshTs > CLEANUP_MAX_AGE_MS) {
                    unlinkSync(path);
                    return null;
                }
                return typeof fresh.sessionId === 'string' ? fresh.sessionId : f.replace(/\.json$/, '');
            });
            if (keptId)
                kept.add(keptId);
        }
        catch {
            // skip
        }
    }
    await cleanupContextCache(kept);
}
