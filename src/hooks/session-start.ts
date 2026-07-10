import { readState, replaceState, updateState, cleanupOldSessions, refreshGitStatus, createEmptySessionState } from '../state.js';
import { getString, runHook, type HookInput } from './common.js';

async function handleSessionStart(input: HookInput): Promise<void> {
  const sessionId = getString(input, 'session_id');
  if (!sessionId) return;

  const cwd = getString(input, 'cwd') ?? process.cwd();
  const source = getString(input, 'source') ?? 'startup';
  const now = new Date().toISOString();

  cleanupOldSessions();

  const existing = readState(sessionId);

  if (source === 'startup' || !existing) {
    const state = createEmptySessionState(sessionId, cwd);
    await refreshGitStatus(state, cwd);
    state.lastActivityAt = now;
    replaceState(sessionId, state);
  } else {
    const cwdChanged = existing.cwd !== '' && existing.cwd !== cwd;
    existing.cwd = cwd;
    existing.lastActivityAt = now;
    await refreshGitStatus(existing, cwd, { useFallback: !cwdChanged });

    if (source === 'clear') {
      existing.lastUserPrompt = '';
    }

    updateState(sessionId, (fresh) => {
      fresh.cwd = cwd;
      fresh.lastActivityAt = now;
      fresh.gitStatus = existing.gitStatus;
      fresh.branch = existing.branch;
      if (source === 'clear') fresh.lastUserPrompt = '';
    }, existing);
  }
}

await runHook('session-start', handleSessionStart);
