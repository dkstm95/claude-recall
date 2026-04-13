import { readStdin } from '../stdin.js';
import { readState, writeState, cleanupOldSessions, getBranch } from '../state.js';
async function main() {
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        process.stdout.write('{}\n');
        return;
    }
    const sessionId = input.session_id;
    const cwd = (input.cwd ?? process.cwd());
    const source = (input.source ?? 'startup');
    const now = new Date().toISOString();
    // Clean up completed sessions older than 7 days
    cleanupOldSessions();
    const existing = readState(sessionId);
    if (source === 'startup' || !existing) {
        // New session
        const state = {
            sessionId,
            purpose: '',
            purposeSource: 'auto',
            branch: getBranch(cwd, ''),
            cwd,
            promptCount: 0,
            lastUserPrompt: '',
            lastActivityAt: now,
        };
        writeState(sessionId, state);
    }
    else {
        // Existing session: update common fields
        existing.lastActivityAt = now;
        existing.branch = getBranch(cwd, existing.branch);
        if (source === 'clear') {
            existing.lastUserPrompt = '';
        }
        writeState(sessionId, existing);
    }
    process.stdout.write('{}\n');
}
main().catch(() => {
    process.stdout.write('{}\n');
});
