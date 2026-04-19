import { readStdin } from '../stdin.js';
import { readState, writeState, getGitStatus } from '../state.js';
import { launchRefinementWorker, isRefiningSubprocess } from '../refine.js';
function isPowerOfTwo(n) {
    return n > 0 && (n & (n - 1)) === 0;
}
async function main() {
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
    const prompt = (input['user_prompt'] ?? input['prompt'] ?? '');
    const cwd = (input['cwd'] ?? process.cwd());
    const transcriptPath = input['transcript_path'];
    const now = new Date().toISOString();
    let state = readState(sessionId);
    if (!state) {
        const gitStatus = getGitStatus(cwd, null);
        state = {
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
    }
    if (prompt.startsWith('/')) {
        state.lastActivityAt = now;
        writeState(sessionId, state);
        process.stdout.write('{}\n');
        return;
    }
    state.promptCount++;
    state.lastUserPrompt = prompt.slice(0, 200).replace(/[\n\t\r]/g, ' ');
    state.lastActivityAt = now;
    // Refresh git status every 10 prompts (the call is expensive)
    if (state.promptCount % 10 === 1 || !state.gitStatus) {
        const gitStatus = getGitStatus(cwd, state.gitStatus);
        state.gitStatus = gitStatus;
        state.branch = gitStatus?.branch ?? state.branch;
    }
    writeState(sessionId, state);
    // Focus refinement at power-of-2 turns (1, 2, 4, 8, 16, 32, ...).
    // Launched as a detached worker so it survives this hook's 10s timeout.
    // First-prompt transcript-flush race is handled inside triggerFocusRefinement.
    if (transcriptPath && isPowerOfTwo(state.promptCount)) {
        launchRefinementWorker(sessionId, transcriptPath);
    }
    process.stdout.write('{}\n');
}
main().catch((err) => {
    process.stderr.write(`[claude-recall prompt-submit] ${err instanceof Error ? err.message : String(err)}\n`);
    process.stdout.write('{}\n');
});
