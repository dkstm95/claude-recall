import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SessionState {
  sessionId: string;
  pid: number;
  purpose: string;
  purposeSource: 'auto' | 'manual' | 'rename';
  purposeSetAt: string;
  branch: string;
  cwd: string;
  status: 'active' | 'completed';
  promptCount: number;
  lastUserPrompt: string;
  lastUserPromptAt: string;
  lastActivityAt: string;
  startedAt: string;
  model: string;
  lastAction?: string;
  recentKeywords?: string[];
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
  const tmp = `${target}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, target);
}

export function listStates(): SessionState[] {
  const dir = getStateDir();
  const files = readdirSync(dir);
  const states: SessionState[] = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.includes('.tmp.')) continue;
    try {
      const raw = readFileSync(join(dir, f), 'utf-8');
      states.push(JSON.parse(raw) as SessionState);
    } catch {
      // skip corrupt files
    }
  }
  return states;
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
      if (state.status === 'completed') {
        const age = now - new Date(state.lastActivityAt).getTime();
        if (age > CLEANUP_MAX_AGE_MS) {
          unlinkSync(join(dir, f));
        }
      }
    } catch {
      // skip
    }
  }
}
