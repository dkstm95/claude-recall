import { readStdin } from '../stdin.js';
import { readState, writeState, cleanupOldSessions, refreshGitStatus, createEmptySessionState } from '../state.js';
import { isRefiningSubprocess } from '../refine.js';
async function main() {
    // Prevent the subprocess from bootstrapping its own state file.
    if (isRefiningSubprocess()) {
        process.stdout.write('{}\n');
        return;
    }
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        process.stdout.write('{}\n');
        return;
    }
    const sessionId = input['session_id'];
    const cwd = (input['cwd'] ?? process.cwd());
    const source = (input['source'] ?? 'startup');
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
    process.stdout.write('{}\n');
}
main().catch((err) => {
    process.stderr.write(`[claude-recall session-start] ${err instanceof Error ? err.message : String(err)}\n`);
    process.stdout.write('{}\n');
});
