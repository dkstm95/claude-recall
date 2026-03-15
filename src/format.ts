import type { SessionState } from './state.js';

export interface BuiltinData {
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number };
  context_window?: { used_percentage?: number };
}

// CJK characters occupy 2 columns in terminal
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||   // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) ||   // CJK Radicals
    (code >= 0x3040 && code <= 0x33bf) ||   // Japanese, CJK Compatibility
    (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Unified Ext A
    (code >= 0x4e00 && code <= 0xa4cf) ||   // CJK Unified + Yi
    (code >= 0xac00 && code <= 0xd7af) ||   // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) ||   // CJK Compatibility Ideographs
    (code >= 0xfe30 && code <= 0xfe4f) ||   // CJK Compatibility Forms
    (code >= 0xff01 && code <= 0xff60) ||   // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) ||   // Fullwidth Signs
    (code >= 0x20000 && code <= 0x2fffd) || // CJK Ext B+
    (code >= 0x30000 && code <= 0x3fffd)    // CJK Ext G+
  );
}

function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  }
  return w;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleWidth(s: string): number {
  return displayWidth(stripAnsi(s));
}

export function truncate(text: string, maxCols: number): string {
  const clean = text.replace(/[\n\t\r]/g, ' ');
  let cols = 0;
  let i = 0;
  for (const ch of clean) {
    const w = isWide(ch.codePointAt(0)!) ? 2 : 1;
    if (cols + w > maxCols - 1 && i < [...clean].length - 1) {
      // Need truncation — check if full string fits
      if (displayWidth(clean) <= maxCols) return clean;
      // Build truncated string
      let result = '';
      let rc = 0;
      for (const c of clean) {
        const cw = isWide(c.codePointAt(0)!) ? 2 : 1;
        if (rc + cw > maxCols - 1) break;
        result += c;
        rc += cw;
      }
      return result + '\u2026';
    }
    cols += w;
    i++;
  }
  return clean;
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

interface RightSegment {
  text: string;
  width: number;
}

function buildRightPart(state: SessionState, elapsed: string, builtin: BuiltinData | undefined): RightSegment[] {
  const segments: RightSegment[] = [];

  const branchPart = state.branch ? cyan(state.branch) + '  ' : '';
  const base = branchPart + dim(elapsed);
  segments.push({ text: base, width: visibleWidth(base) });

  if (!builtin) return segments;

  if (builtin.model?.display_name) {
    const s = yellow(builtin.model.display_name);
    segments.push({ text: s, width: visibleWidth(s) });
  }

  if (builtin.context_window?.used_percentage != null) {
    const s = dim(`${Math.round(builtin.context_window.used_percentage)}%`);
    segments.push({ text: s, width: visibleWidth(s) });
  }

  if (builtin.cost?.total_cost_usd != null) {
    const cost = builtin.cost.total_cost_usd;
    const s = dim(cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`);
    segments.push({ text: s, width: visibleWidth(s) });
  }

  return segments;
}

const MIN_PURPOSE_COLS = 15;
const SEPARATOR = dim(' \u2502 ');
const SEPARATOR_WIDTH = 3;
const PURPOSE_HINT_THRESHOLD = 10;

export function formatHud(state: SessionState, termWidth: number, builtin?: BuiltinData): string {
  const elapsed = formatElapsed(state.lastActivityAt || state.startedAt);
  const prefixWidth = 3; // " ⎯ "

  const segments = buildRightPart(state, elapsed, builtin);

  let rightText = '';
  let rightWidth = 0;

  // Progressively drop rightmost segments until purpose has enough space
  for (let count = segments.length; count >= 1; count--) {
    const used = segments.slice(0, count);
    const builtinParts = used.slice(1);
    let text: string;
    let w: number;

    if (builtinParts.length > 0) {
      const builtinText = builtinParts.map(s => s.text).join('  ');
      const builtinW = builtinParts.reduce((sum, s) => sum + s.width, 0) + (builtinParts.length - 1) * 2;
      text = used[0].text + SEPARATOR + builtinText;
      w = used[0].width + SEPARATOR_WIDTH + builtinW;
    } else {
      text = used[0].text;
      w = used[0].width;
    }

    const availPurpose = termWidth - prefixWidth - w - 2;
    if (availPurpose >= MIN_PURPOSE_COLS || count === 1) {
      rightText = text;
      rightWidth = w;
      break;
    }
  }

  // If even branch+elapsed overflows, hide right part entirely
  if (termWidth - prefixWidth - rightWidth - 2 < MIN_PURPOSE_COLS) {
    rightText = '';
    rightWidth = 0;
  }

  // Purpose hint: show (try /purpose) when auto purpose is stale
  const showHint = state.purposeSource === 'auto'
    && state.promptCount >= PURPOSE_HINT_THRESHOLD;
  const hintText = showHint ? dim('  (try /purpose)') : '';
  const hintWidth = showHint ? 16 : 0;

  // Purpose line
  const prefix1 = dim(' \u23AF ');
  const availPurpose = termWidth - prefixWidth - hintWidth - (rightWidth > 0 ? rightWidth + 2 : 0);
  const purpose = state.purpose
    ? truncate(state.purpose, Math.max(availPurpose, MIN_PURPOSE_COLS))
    : dim('(no purpose yet)');
  const purposeWidth = state.purpose
    ? displayWidth(stripAnsi(purpose))
    : 16;

  const gap = Math.max(1, termWidth - prefixWidth - purposeWidth - hintWidth - rightWidth);
  const line1 = prefix1 + purpose + hintText + ' '.repeat(gap) + rightText;

  // Last prompt line with turn count
  if (!state.lastUserPrompt) return line1;

  const prefix2 = dim(' \u203A ');
  const turnLabel = dim(`#${state.promptCount}  `);
  const turnWidth = `#${state.promptCount}  `.length;
  const maxPromptCols = Math.min(termWidth - 3 - turnWidth, 80);
  const line2 = prefix2 + turnLabel + truncate(state.lastUserPrompt, Math.max(maxPromptCols, 15));

  return line1 + '\n' + line2;
}
