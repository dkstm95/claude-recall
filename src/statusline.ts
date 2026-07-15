import { readStdin } from './stdin.js';
import { readState, createEmptySessionState, refreshGitStatus } from './state.js';
import { formatStatusline, getTerminalWidth, type BuiltinData } from './format.js';
import { readConfig } from './config.js';
import { resolveRateLimits, type RateLimitsData } from './rate-limits-cache.js';
import { resolveContextWindow, type ContextWindowData } from './context-window-cache.js';
import { normalizeNonNegativeNumber, normalizePercentage } from './metrics.js';

interface StatuslineInput {
  session_id?: string;
  cwd?: string;
  model?: { display_name?: string; id?: string };
  cost?: { total_cost_usd?: number; total_duration_ms?: number };
  context_window?: ContextWindowData;
  workspace?: { git_worktree?: string; current_dir?: string; project_dir?: string };
  worktree?: { name?: string; path?: string; branch?: string; original_cwd?: string; original_branch?: string };
  effort?: { level?: string };
  thinking?: { enabled?: boolean };
  session_name?: string;
  agent?: { name?: string };
  pr?: { number?: number; title?: string; url?: string };
  rate_limits?: RateLimitsData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function stringFields(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, string> | undefined {
  if (!value) return undefined;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const field = stringAt(value, key);
    if (field !== undefined) out[key] = field;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeRateLimits(value: Record<string, unknown> | undefined): RateLimitsData | undefined {
  if (!value) return undefined;
  const normalizeWindow = (key: string) => {
    const raw = recordAt(value, key);
    if (!raw) return undefined;
    const usedPercentage = normalizePercentage(raw['used_percentage']);
    const resetsAt = normalizeNonNegativeNumber(raw['resets_at']);
    if (usedPercentage === undefined) return undefined;
    return resetsAt === undefined
      ? { used_percentage: usedPercentage }
      : { used_percentage: usedPercentage, resets_at: resetsAt };
  };
  const fiveHour = normalizeWindow('five_hour');
  const sevenDay = normalizeWindow('seven_day');
  return fiveHour || sevenDay
    ? { five_hour: fiveHour, seven_day: sevenDay }
    : undefined;
}

function normalizeInput(value: unknown): StatuslineInput | null {
  if (!isRecord(value)) return null;
  const sessionId = stringAt(value, 'session_id');
  if (!sessionId) return null;

  const modelRaw = recordAt(value, 'model');
  const costRaw = recordAt(value, 'cost');
  const contextRaw = recordAt(value, 'context_window');
  const effortRaw = recordAt(value, 'effort');
  const thinkingRaw = recordAt(value, 'thinking');
  const prRaw = recordAt(value, 'pr');
  const costUsd = normalizeNonNegativeNumber(costRaw?.['total_cost_usd']);
  const durationMs = normalizeNonNegativeNumber(costRaw?.['total_duration_ms']);
  const contextPct = normalizePercentage(contextRaw?.['used_percentage']);
  const prNumber = normalizeNonNegativeNumber(prRaw?.['number']);

  return {
    session_id: sessionId,
    cwd: stringAt(value, 'cwd'),
    model: stringFields(modelRaw, ['display_name', 'id']),
    cost: costUsd !== undefined || durationMs !== undefined
      ? { total_cost_usd: costUsd, total_duration_ms: durationMs }
      : undefined,
    context_window: contextPct === undefined ? undefined : { used_percentage: contextPct },
    workspace: stringFields(recordAt(value, 'workspace'), ['git_worktree', 'current_dir', 'project_dir']),
    worktree: stringFields(recordAt(value, 'worktree'), ['name', 'path', 'branch', 'original_cwd', 'original_branch']),
    effort: typeof effortRaw?.['level'] === 'string' ? { level: effortRaw['level'] } : undefined,
    thinking: typeof thinkingRaw?.['enabled'] === 'boolean' ? { enabled: thinkingRaw['enabled'] } : undefined,
    session_name: stringAt(value, 'session_name'),
    agent: stringFields(recordAt(value, 'agent'), ['name']),
    pr: prNumber !== undefined || typeof prRaw?.['title'] === 'string' || typeof prRaw?.['url'] === 'string'
      ? {
          number: prNumber === undefined ? undefined : Math.trunc(prNumber),
          title: typeof prRaw?.['title'] === 'string' ? prRaw['title'] : undefined,
          url: typeof prRaw?.['url'] === 'string' ? prRaw['url'] : undefined,
        }
      : undefined,
    rate_limits: normalizeRateLimits(recordAt(value, 'rate_limits')),
  };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const input = normalizeInput(parsed);
  if (!input?.session_id) process.exit(0);

  // SessionStart hook may not have flushed state yet on first statusline render.
  const cwd = input.cwd ?? input.workspace?.current_dir ?? input.workspace?.project_dir ?? '';
  const state = readState(input.session_id) ?? createEmptySessionState(input.session_id, cwd);
  const cwdChanged = Boolean(cwd && state.cwd && state.cwd !== cwd);
  if (cwd) state.cwd = cwd;

  // Render-time refresh: hooks can't see mid-turn checkouts and the first
  // render beats SessionStart's state flush. Mutation is scratch-only — not persisted.
  if (cwd) await refreshGitStatus(state, cwd, { useFallback: !cwdChanged });

  const [contextWindow, rateLimits] = await Promise.all([
    resolveContextWindow(input.session_id, input.context_window),
    resolveRateLimits(input.rate_limits),
  ]);
  const builtin: BuiltinData = {
    model: input.model,
    cost: input.cost,
    context_window: contextWindow,
    workspace: input.workspace,
    worktree: input.worktree,
    effort: input.effort,
    thinking: input.thinking,
    session_name: input.session_name,
    agent: input.agent,
    pr: input.pr,
    rate_limits: rateLimits,
  };

  const config = readConfig();
  const output = formatStatusline(state, getTerminalWidth(), builtin, config);
  process.stdout.write(output + '\n');
}

main().catch(() => process.exit(0));
