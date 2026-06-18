import { readState, writeState, refreshGitStatus, createEmptySessionState } from '../state.js';
import { getString, runHook } from './common.js';
async function handleCwdChanged(input) {
    const sessionId = getString(input, 'session_id');
    if (!sessionId)
        return;
    const cwd = getString(input, 'new_cwd') ?? getString(input, 'cwd') ?? process.cwd();
    const now = new Date().toISOString();
    const state = readState(sessionId) ?? createEmptySessionState(sessionId, cwd);
    state.cwd = cwd;
    state.lastActivityAt = now;
    await refreshGitStatus(state, cwd, { useFallback: false });
    writeState(sessionId, state);
}
await runHook('cwd-changed', handleCwdChanged);
