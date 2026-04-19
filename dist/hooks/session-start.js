import { readStdin } from '../stdin.js';
import { readState, writeState, cleanupOldSessions, getGitStatus } from '../state.js';
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
        const gitStatus = getGitStatus(cwd, null);
        const state = {
            sessionId,
            focus: '',
            branch: gitStatus?.branch ?? '',
            gitStatus,
            cwd,
            promptCount: 0,
            lastUserPrompt: '',
            lastActivityAt: now,
            lastRefinedAt: null,
            refinementError: null,
            lastRefinement: null,
        };
        writeState(sessionId, state);
    }
    else {
        existing.lastActivityAt = now;
        const gitStatus = getGitStatus(cwd, existing.gitStatus);
        existing.gitStatus = gitStatus;
        existing.branch = gitStatus?.branch ?? existing.branch;
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
