import { readStdin } from './stdin.js';
import { readState } from './state.js';
import { formatHud, getTerminalWidth } from './format.js';
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
    const builtin = {
        model: input.model,
        cost: input.cost,
        context_window: input.context_window,
    };
    const hud = formatHud(state, getTerminalWidth(), builtin);
    process.stdout.write(hud + '\n');
}
main().catch(() => process.exit(0));
