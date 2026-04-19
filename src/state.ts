import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { cleanupContextCache } from './context-window-cache.js';

const execFileAsync = promisify(execFile);

export interface GitStatus {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  defaultBranch: string;
}

export interface RefinementError {
  code: 'timeout' | 'rate_limit' | 'auth' | 'unknown';
  at: string;
  durationMs?: number;
  stderrTail?: string;
}

// Snapshot of the most recent refinement attempt, success or failure.
// Kept separate from refinementError (which tracks only the current error state)
// so successes also leave a durationMs baseline for diagnosing slow cases.
export interface LastRefinement {
  at: string;
  status: 'ok' | 'error';
  code?: RefinementError['code'];
  durationMs: number;
  transcriptBytes: number;
  stdoutBytes?: number;
  stderrTail?: string;
}

export interface SessionState {
  sessionId: string;
  focus: string;
  branch: string;
  gitStatus: GitStatus | null;
  cwd: string;
  promptCount: number;
  lastUserPrompt: string;
  // Wall-clock timestamp when the session was first opened. Set once at
  // SessionStart (startup source) and never overwritten, so it pairs with
  // stdin `cost.total_duration_ms` (also wall-clock since session started)
  // when that field is absent.
  sessionStartedAt: string;
  lastActivityAt: string;
  lastRefinedAt: string | null;
  refinementError: RefinementError | null;
  lastRefinement: LastRefinement | null;
}

export function createEmptySessionState(sessionId: string, cwd: string): SessionState {
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

export function getStateDir(): string {
  const dir = join(homedir(), '.claude', 'claude-recall', 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getStatePath(sessionId: string): string {
  return join(getStateDir(), `${sessionId}.json`);
}

export function readState(sessionId: string): SessionState | null {
  try {
    const raw = readFileSync(getStatePath(sessionId), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed['focus'] === undefined && typeof parsed['purpose'] === 'string') {
      parsed['focus'] = parsed['purpose'];
    }

    const lastActivityAt = (parsed['lastActivityAt'] as string) ?? new Date().toISOString();
    return {
      sessionId: (parsed['sessionId'] as string) ?? sessionId,
      focus: (parsed['focus'] as string) ?? '',
      branch: (parsed['branch'] as string) ?? '',
      gitStatus: (parsed['gitStatus'] as GitStatus | null) ?? null,
      cwd: (parsed['cwd'] as string) ?? '',
      promptCount: (parsed['promptCount'] as number) ?? 0,
      lastUserPrompt: (parsed['lastUserPrompt'] as string) ?? '',
      sessionStartedAt: (parsed['sessionStartedAt'] as string) ?? lastActivityAt,
      lastActivityAt,
      lastRefinedAt: (parsed['lastRefinedAt'] as string | null) ?? null,
      refinementError: (parsed['refinementError'] as RefinementError | null) ?? null,
      lastRefinement: (parsed['lastRefinement'] as LastRefinement | null) ?? null,
    };
  } catch {
    return null;
  }
}

export function writeState(sessionId: string, state: SessionState): void {
  const target = getStatePath(sessionId);
  const tmp = `${target}.tmp.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, target);
}

async function runGit(cwd: string, args: string[], timeoutMs = 1000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf-8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  return stdout.trim();
}

export async function refreshGitStatus(state: SessionState, cwd: string): Promise<void> {
  const gitStatus = await getGitStatus(cwd, state.gitStatus);
  state.gitStatus = gitStatus;
  state.branch = gitStatus?.branch ?? state.branch;
}

// --no-optional-locks avoids blocking a concurrent user `git status`; callers
// (statusline + hooks) stay within their 1-10s budgets via the per-call timeout.
export async function getGitStatus(cwd: string, fallback: GitStatus | null): Promise<GitStatus | null> {
  try {
    const [branchR, dirtyR, defaultR] = await Promise.all([
      runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null),
      runGit(cwd, ['--no-optional-locks', 'status', '--porcelain']).catch(() => null),
      runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => null),
    ]);

    if (branchR === null) return fallback;
    let branch = branchR;
    if (branch === 'HEAD') {
      branch = await runGit(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => 'HEAD');
    }

    const dirty = dirtyR !== null && dirtyR.length > 0;

    let defaultBranch = 'main';
    if (defaultR) {
      defaultBranch = defaultR.replace(/^origin\//, '');
    } else {
      const master = await runGit(cwd, ['rev-parse', '--verify', 'origin/master']).catch(() => null);
      if (master !== null) defaultBranch = 'master';
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
  } catch {
    return fallback;
  }
}

const CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function cleanupOldSessions(): void {
  const dir = getStateDir();
  const now = Date.now();
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  const kept = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.json') || f.includes('.tmp.')) continue;
    try {
      const raw = readFileSync(join(dir, f), 'utf-8');
      const state = JSON.parse(raw) as { lastActivityAt?: string };
      const ts = new Date(state.lastActivityAt ?? 0).getTime();
      if (isNaN(ts) || now - ts > CLEANUP_MAX_AGE_MS) {
        unlinkSync(join(dir, f));
      } else {
        kept.add(f.replace(/\.json$/, ''));
      }
    } catch {
      // skip
    }
  }
  cleanupContextCache(kept);
}
