import { readStdin } from './stdin.js';
import { readState } from './state.js';
import { formatHud, getTerminalWidth, type BuiltinData } from './format.js';
import { readConfig } from './config.js';

interface StatuslineInput {
  session_id?: string;
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number; total_duration_ms?: number };
  context_window?: { used_percentage?: number };
  workspace?: { git_worktree?: string };
  rate_limits?: {
    five_hour?: { used_percentage?: number };
    seven_day?: { used_percentage?: number };
  };
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
    workspace: input.workspace,
    rate_limits: input.rate_limits,
  };

  const config = readConfig();
  const hud = formatHud(state, getTerminalWidth(), builtin, config);
  process.stdout.write(hud + '\n');
}

main().catch(() => process.exit(0));
