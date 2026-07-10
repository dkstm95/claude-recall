import { readState, updateState, refreshGitStatus, createEmptySessionState } from '../state.js';
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
    updateState(sessionId, (fresh) => {
        fresh.cwd = cwd;
        fresh.lastActivityAt = now;
        fresh.gitStatus = state.gitStatus;
        fresh.branch = state.branch;
    }, state);
}
await runHook('cwd-changed', handleCwdChanged);
