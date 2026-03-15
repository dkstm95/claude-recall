import type { SessionState } from './state.js';

export interface BuiltinData {
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number };
  context_window?: { used_percentage?: number };
}

export function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/[\n\t\r]/g, ' ');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '\u2026';
}

export function formatElapsed(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

export function getTerminalWidth(): number {
  const env = parseInt(process.env['COLUMNS'] ?? '', 10);
  if (!isNaN(env) && env > 0) return env;
  return 80;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function stripAnsi(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function formatBuiltinPart(builtin: BuiltinData): string {
  const parts: string[] = [];

  if (builtin.model?.display_name) {
    parts.push(yellow(builtin.model.display_name));
  }

  if (builtin.context_window?.used_percentage != null) {
    const pct = Math.round(builtin.context_window.used_percentage);
    parts.push(dim(`${pct}%`));
  }

  if (builtin.cost?.total_cost_usd != null) {
    const cost = builtin.cost.total_cost_usd;
    const formatted = cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`;
    parts.push(dim(formatted));
  }

  if (parts.length === 0) return '';
  return dim(' \u2502 ') + parts.join('  ');
}

export function formatHud(state: SessionState, termWidth: number, builtin?: BuiltinData): string {
  const elapsed = formatElapsed(state.lastActivityAt || state.startedAt);

  // Build right section: branch + elapsed + builtin metrics
  let builtinPart = builtin ? formatBuiltinPart(builtin) : '';
  let rightPart = '';

  if (termWidth >= 50) {
    const branchPart = state.branch ? cyan(state.branch) : '';
    rightPart = branchPart + '  ' + dim(elapsed) + builtinPart;
  }

  const rightVisible = stripAnsi(rightPart);

  // Purpose line
  const prefix1 = dim(' \u23AF ');
  const prefixLen1 = 3; // " ⎯ "
  const availPurpose = termWidth - prefixLen1 - (rightVisible > 0 ? rightVisible + 2 : 0);
  const purpose = state.purpose
    ? truncate(state.purpose, Math.max(availPurpose, 10))
    : dim('(no purpose yet)');
  const purposeVisible = state.purpose
    ? truncate(state.purpose, Math.max(availPurpose, 10)).length
    : 16;

  const gap = Math.max(1, termWidth - prefixLen1 - purposeVisible - rightVisible);
  const line1 = prefix1 + purpose + ' '.repeat(gap) + rightPart;

  // Last prompt line
  if (!state.lastUserPrompt) return line1;

  const prefix2 = dim(' \u203A ');
  const maxPromptLen = Math.min(termWidth - 3, 80);
  const line2 = prefix2 + truncate(state.lastUserPrompt, maxPromptLen);

  return line1 + '\n' + line2;
}
