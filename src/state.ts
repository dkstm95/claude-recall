import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SessionState {
  sessionId: string;
  purpose: string;
  purposeSource: 'auto' | 'manual' | 'rename';
  branch: string;
  cwd: string;
  promptCount: number;
  lastUserPrompt: string;
  lastActivityAt: string;
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
    return JSON.parse(raw) as SessionState;
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

export function getBranch(cwd: string, fallback: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: 2000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    }).trim();
  } catch (err: unknown) {
    // If not a git repo, return empty (don't persist stale branch)
    const message = err instanceof Error ? err.message : '';
    if (message.includes('not a git repository')) return '';
    // For other errors (timeout, permissions), keep fallback
    return fallback;
  }
}

const CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
      const state = JSON.parse(raw) as SessionState;
      const ts = new Date(state.lastActivityAt).getTime();
      if (isNaN(ts) || now - ts > CLEANUP_MAX_AGE_MS) {
        unlinkSync(join(dir, f));
      }
    } catch {
      // skip
    }
  }
}
