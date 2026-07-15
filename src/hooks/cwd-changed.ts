import {
  applyGitStatus,
  createEmptySessionState,
  getGitStatus,
  updateState,
} from '../state.js';
import { getString, runHook, type HookInput } from './common.js';

async function handleCwdChanged(input: HookInput): Promise<void> {
  const sessionId = getString(input, 'session_id');
  if (!sessionId) return;

  const cwd = getString(input, 'new_cwd') ?? getString(input, 'cwd') ?? process.cwd();
  const now = new Date().toISOString();
  const gitStatus = await getGitStatus(cwd, null);
  await updateState(sessionId, (current) => {
    const state = current ?? createEmptySessionState(sessionId, cwd);
    state.cwd = cwd;
    state.lastActivityAt = now;
    applyGitStatus(state, gitStatus, { useFallback: false });
    return { state, value: undefined };
  });
}

await runHook('cwd-changed', handleCwdChanged);
