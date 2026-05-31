import type { RateLimitsData } from './rate-limits-cache.js';

export interface BuiltinData {
  model?: { display_name?: string; id?: string };
  cost?: { total_cost_usd?: number; total_duration_ms?: number };
  context_window?: { used_percentage?: number };
  workspace?: { git_worktree?: string };
  worktree?: { name?: string; path?: string; branch?: string; original_cwd?: string; original_branch?: string };
  effort?: { level?: string };
  thinking?: { enabled?: boolean };
  session_name?: string;
  agent?: { name?: string };
  pr?: { number?: number; title?: string; url?: string };
  rate_limits?: RateLimitsData;
}
