import type { SessionState } from './state.js';
import type { StatuslineConfig } from './config.js';
import type { RenderContext } from './statusline-render-context.js';
import type { BuiltinData } from './statusline-types.js';
import { getThemeColors } from './config.js';
import {
  formatElapsed,
  formatElapsedMs,
} from './terminal-text.js';
import {
  makeJoiner,
} from './statusline-layout.js';
import { renderLine1 } from './statusline-line1.js';
import { renderLine2 } from './statusline-line2.js';
import { renderLine3 } from './statusline-line3.js';

export {
  displayWidth,
  formatElapsed,
  formatElapsedMs,
  getTerminalWidth,
  stripAnsi,
  truncate,
} from './terminal-text.js';
export {
  makeJoiner,
  padSegmentLeft,
  progressiveJoin,
  type Joiner,
  type Segment,
} from './statusline-layout.js';
export type { BuiltinData } from './statusline-types.js';
export { FOCUS_PLACEHOLDER } from './statusline-line1.js';
export { PROMPT_PLACEHOLDER } from './statusline-line2.js';

function sessionColor(cwd: string, branch: string, accents: ((s: string) => string)[]): (s: string) => string {
  const key = `${cwd}:${branch}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return accents[Math.abs(hash) % accents.length];
}

const DEFAULT_FORMAT_CONFIG: StatuslineConfig = {
  line1: ['focus', 'branch', 'model'],
  line2: ['turn', 'prompt', 'elapsed'],
  line3: ['context', 'rate_limits', 'seven_day', 'cost'],
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
  theme: 'default',
  separator: '│',
};

export function formatStatusline(
  state: SessionState,
  termWidth: number,
  builtin?: BuiltinData,
  config?: StatuslineConfig,
): string {
  const cfg = config ?? DEFAULT_FORMAT_CONFIG;
  const tc = getThemeColors(cfg.theme);
  const joiner = makeJoiner(cfg.separator, tc);
  const gridOn = cfg.separator !== '';
  // Fallback uses sessionStartedAt (not lastActivityAt) to match stdin's
  // "wall-clock since session started" semantic.
  const elapsed = builtin?.cost?.total_duration_ms != null
    ? formatElapsedMs(builtin.cost.total_duration_ms)
    : formatElapsed(state.sessionStartedAt);
  const prefixWidth = 3;

  const accent = sessionColor(state.cwd, state.branch, tc.accents);
  const prefix = ' ' + accent('\u258D') + ' ';

  const ctxPct = builtin?.context_window?.used_percentage;
  const renderCtx: RenderContext = {
    state,
    termWidth,
    builtin,
    cfg,
    tc,
    joiner,
    gridOn,
    prefix,
    prefixWidth,
    elapsed,
  };

  const line1 = renderLine1(renderCtx);
  const line2 = renderLine2(renderCtx);

  // Line 3 priority: ctx > 5h > 7d > cost. See renderLine3() for the compaction ladder.
  const line3Body = renderLine3(cfg.line3, builtin, ctxPct, tc, termWidth - prefixWidth, joiner);
  const line3 = line3Body !== null ? prefix + line3Body : null;

  const parts: string[] = [line1];
  if (line2) parts.push(line2);
  if (line3) parts.push(line3);
  return parts.join('\n');
}
