import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
  lastActivityAt: string;
  lastRefinedAt: string | null;
  refinementError: RefinementError | null;
  lastRefinement: LastRefinement | null;
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

    return {
      sessionId: (parsed['sessionId'] as string) ?? sessionId,
      focus: (parsed['focus'] as string) ?? '',
      branch: (parsed['branch'] as string) ?? '',
      gitStatus: (parsed['gitStatus'] as GitStatus | null) ?? null,
      cwd: (parsed['cwd'] as string) ?? '',
      promptCount: (parsed['promptCount'] as number) ?? 0,
      lastUserPrompt: (parsed['lastUserPrompt'] as string) ?? '',
      lastActivityAt: (parsed['lastActivityAt'] as string) ?? new Date().toISOString(),
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

function runGit(cwd: string, args: string[]): string {
  return execSync(`git ${args.join(' ')}`, {
    cwd,
    timeout: 2000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  }).trim();
}

export function getGitStatus(cwd: string, fallback: GitStatus | null): GitStatus | null {
  try {
    let branch = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') {
      try {
        branch = runGit(cwd, ['rev-parse', '--short', 'HEAD']);
      } catch { /* keep 'HEAD' */ }
    }

    let dirty = false;
    try {
      dirty = runGit(cwd, ['status', '--porcelain']).length > 0;
    } catch { /* treat as clean */ }

    let defaultBranch = 'main';
    try {
      const ref = runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      defaultBranch = ref.replace(/^origin\//, '');
    } catch {
      try {
        runGit(cwd, ['rev-parse', '--verify', 'origin/master']);
        defaultBranch = 'master';
      } catch { /* keep 'main' guess */ }
    }

    let ahead = 0;
    let behind = 0;
    try {
      const out = runGit(cwd, ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`]);
      const parts = out.split(/\s+/).map((n) => parseInt(n, 10));
      behind = Number.isFinite(parts[0]) ? parts[0] : 0;
      ahead = Number.isFinite(parts[1]) ? parts[1] : 0;
    } catch { /* origin/<default> absent */ }

    return { branch, dirty, ahead, behind, defaultBranch };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('not a git repository')) return null;
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
  for (const f of files) {
    if (!f.endsWith('.json') || f.includes('.tmp.')) continue;
    try {
      const raw = readFileSync(join(dir, f), 'utf-8');
      const state = JSON.parse(raw) as { lastActivityAt?: string };
      const ts = new Date(state.lastActivityAt ?? 0).getTime();
      if (isNaN(ts) || now - ts > CLEANUP_MAX_AGE_MS) {
        unlinkSync(join(dir, f));
      }
    } catch {
      // skip
    }
  }
}
