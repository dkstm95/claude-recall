import { readStdin } from './stdin.js';
import { readState, writeState } from './state.js';
import { formatHud, getTerminalWidth } from './format.js';
import { readConfig } from './config.js';
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
    const state = readState(input.session_id);
    if (!state)
        process.exit(0);
    // Sync rename: when Claude Code's session_name (from --name or /rename) differs
    // from our tracked purpose, adopt it. Manual purposes are never overwritten.
    if (input.session_name &&
        state.purposeSource !== 'manual' &&
        state.purpose !== input.session_name) {
        state.purpose = input.session_name;
        state.purposeSource = 'rename';
        writeState(input.session_id, state);
    }
    const builtin = {
        model: input.model,
        cost: input.cost,
        context_window: input.context_window,
        workspace: input.workspace,
        rate_limits: input.rate_limits,
    };
    const config = readConfig();
    const hud = formatHud(state, getTerminalWidth(), builtin, config);
    process.stdout.write(hud + '\n');
}
main().catch(() => process.exit(0));
