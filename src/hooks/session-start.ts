import {
  applyGitStatus,
  cleanupOldSessions,
  createEmptySessionState,
  getGitStatus,
  readState,
  updateState,
} from '../state.js';
import { getString, runHook, type HookInput } from './common.js';

async function handleSessionStart(input: HookInput): Promise<void> {
  const sessionId = getString(input, 'session_id');
  if (!sessionId) return;

  const cwd = getString(input, 'cwd') ?? process.cwd();
  const source = getString(input, 'source') ?? 'startup';
  const now = new Date().toISOString();

  await cleanupOldSessions();

  const existing = readState(sessionId);
  const existingSnapshot = existing ? JSON.stringify(existing) : null;
  const reset = source === 'startup' || !existing;
  const cwdChanged = !!existing && existing.cwd !== '' && existing.cwd !== cwd;
  const useFallback = !reset && !cwdChanged;
  const gitStatus = await getGitStatus(cwd, useFallback ? existing?.gitStatus ?? null : null);

  await updateState(sessionId, (current) => {
    const changedSinceSnapshot = !!current && (
      existingSnapshot === null || JSON.stringify(current) !== existingSnapshot
    );
    if (!current || (source === 'startup' && !changedSinceSnapshot)) {
      const state = createEmptySessionState(sessionId, cwd);
      applyGitStatus(state, gitStatus, { useFallback: false });
      state.lastActivityAt = now;
      return { state, value: undefined };
    }

    // A prompt/refinement hook may have committed while SessionStart was
    // doing cleanup or git I/O. Do not overwrite any of its newer cwd/time/git
    // fields with this event's stale snapshot.
    if (source === 'startup' && changedSinceSnapshot) {
      return { value: undefined };
    }

    const state = current;
    state.cwd = cwd;
    state.lastActivityAt = now;
    applyGitStatus(state, gitStatus, { useFallback });

    if (source === 'clear') {
      state.lastUserPrompt = '';
    }

    return { state, value: undefined };
  });
}

await runHook('session-start', handleSessionStart);
