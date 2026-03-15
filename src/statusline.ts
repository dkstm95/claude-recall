import { readStdin } from './stdin.js';
import { readState } from './state.js';
import { formatHud, getTerminalWidth, type BuiltinData } from './format.js';

interface StatuslineInput {
  session_id?: string;
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number };
  context_window?: { used_percentage?: number };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: StatuslineInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!input.session_id) process.exit(0);

  const state = readState(input.session_id);
  if (!state) process.exit(0);

  const builtin: BuiltinData = {
    model: input.model,
    cost: input.cost,
    context_window: input.context_window,
  };

  const hud = formatHud(state, getTerminalWidth(), builtin);
  process.stdout.write(hud + '\n');
}

main().catch(() => process.exit(0));
