import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
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
