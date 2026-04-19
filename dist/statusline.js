import { readStdin } from './stdin.js';
import { readState, createEmptySessionState, refreshGitStatus } from './state.js';
import { formatStatusline, getTerminalWidth } from './format.js';
import { readConfig } from './config.js';
import { resolveRateLimits } from './rate-limits-cache.js';
import { resolveContextWindow } from './context-window-cache.js';
async function main() {
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        process.exit(0);
    }
    if (!input.session_id)
        process.exit(0);
    // SessionStart hook may not have flushed state yet on first statusline render.
    const cwd = input.cwd ?? input.workspace?.current_dir ?? input.workspace?.project_dir ?? '';
    const state = readState(input.session_id) ?? createEmptySessionState(input.session_id, cwd);
    // Render-time refresh: hooks can't see mid-turn checkouts and the first
    // render beats SessionStart's state flush. Mutation is scratch-only — not persisted.
    if (cwd)
        await refreshGitStatus(state, cwd);
    const builtin = {
        model: input.model,
        cost: input.cost,
        context_window: resolveContextWindow(input.session_id, input.context_window),
        workspace: input.workspace,
        rate_limits: resolveRateLimits(input.rate_limits),
    };
    const config = readConfig();
    const output = formatStatusline(state, getTerminalWidth(), builtin, config);
    process.stdout.write(output + '\n');
}
main().catch(() => process.exit(0));
