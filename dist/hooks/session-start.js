import { readState, writeState, cleanupOldSessions, refreshGitStatus, createEmptySessionState } from '../state.js';
import { getString, runHook } from './common.js';
async function handleSessionStart(input) {
    const sessionId = getString(input, 'session_id');
    if (!sessionId)
        return;
    const cwd = getString(input, 'cwd') ?? process.cwd();
    const source = getString(input, 'source') ?? 'startup';
    const now = new Date().toISOString();
    cleanupOldSessions();
    const existing = readState(sessionId);
    if (source === 'startup' || !existing) {
        const state = createEmptySessionState(sessionId, cwd);
        await refreshGitStatus(state, cwd);
        state.lastActivityAt = now;
        writeState(sessionId, state);
    }
    else {
        existing.lastActivityAt = now;
        await refreshGitStatus(existing, cwd);
        if (source === 'clear') {
            existing.lastUserPrompt = '';
        }
        writeState(sessionId, existing);
    }
}
await runHook('session-start', handleSessionStart);
