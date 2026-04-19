import { readStdin } from './stdin.js';
import { readState, createEmptySessionState, refreshGitStatus } from './state.js';
import { formatStatusline, getTerminalWidth, type BuiltinData } from './format.js';
import { readConfig } from './config.js';
import { resolveRateLimits, type RateLimitsData } from './rate-limits-cache.js';
import { resolveContextWindow, type ContextWindowData } from './context-window-cache.js';

interface StatuslineInput {
  session_id?: string;
  cwd?: string;
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number; total_duration_ms?: number };
  context_window?: ContextWindowData;
  workspace?: { git_worktree?: string; current_dir?: string; project_dir?: string };
  rate_limits?: RateLimitsData;
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

  // SessionStart hook may not have flushed state yet on first statusline render.
  const cwd = input.cwd ?? input.workspace?.current_dir ?? input.workspace?.project_dir ?? '';
  const state = readState(input.session_id) ?? createEmptySessionState(input.session_id, cwd);

  // Render-time refresh: hooks can't see mid-turn checkouts and the first
  // render beats SessionStart's state flush. Mutation is scratch-only — not persisted.
  if (cwd) await refreshGitStatus(state, cwd);

  const builtin: BuiltinData = {
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
