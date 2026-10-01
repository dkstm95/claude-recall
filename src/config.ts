import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getClaudeConfigDir } from './paths.js';

export interface GitStatusConfig {
  enabled: boolean;
  showDirty: boolean;
  showAheadBehind: boolean;
}

const VALID_THEMES = ['default', 'minimal', 'vivid', 'light'] as const;
export type Theme = typeof VALID_THEMES[number];

export interface StatuslineConfig {
  line1: string[];
  line2: string[];
  line3: string[];
  gitStatus: GitStatusConfig;
  theme: Theme;
  separator: string;
  widthReserve: number;
}

export const DEFAULT_CONFIG: StatuslineConfig = {
  line1: ['focus', 'branch', 'model'],
  line2: ['turn', 'prompt', 'elapsed'],
  line3: ['context', 'rate_limits', 'seven_day', 'cost'],
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
  theme: 'default',
  separator: '│',
  // Claude UI padding (2 columns per side) + setup's statusLine.padding=1.
  widthReserve: 6,
};

const VALID_LINE1 = ['focus', 'branch', 'model', 'worktree', 'session', 'agent', 'pr', 'review', 'fast_mode'];
const VALID_LINE2 = ['turn', 'prompt', 'elapsed'];
const VALID_LINE3 = ['context', 'rate_limits', 'seven_day', 'spend_limit', 'prompt_cache', 'cost'];

type ColorFn = (s: string) => string;

export interface ThemeColors {
  focus: ColorFn;
  branch: ColorFn;
  model: ColorFn;
  worktree: ColorFn;
  prompt: ColorFn;
  dim: ColorFn;
  green: ColorFn;
  yellow: ColorFn;
  red: ColorFn;
  accents: ColorFn[];
}

const IDENTITY: ColorFn = (s) => s;

// Empty code string → IDENTITY. A literal \x1b[m would emit a reset, not a no-op.
const mk = (code: string): ColorFn =>
  code ? (s) => `\x1b[${code}m${s}\x1b[0m` : IDENTITY;

interface ThemeCodes {
  focus: string;
  branch: string;
  model: string;
  worktree: string;
  prompt: string;
  dim: string;
  green: string;
  yellow: string;
  red: string;
  accents: string[];
}

// Fixed 24-bit foreground colors keep these themes independent of the
// terminal's 16-color palette. The terminal still owns its background.
function rgb(hex: string): string {
  return `38;2;${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(';')}`;
}

function colorTheme(palette: {
  text: string; dim: string; cyan: string; purple: string;
  blue: string; yellow: string; green: string; red: string;
}): ThemeCodes {
  return {
    focus: `1;${rgb(palette.cyan)}`, branch: rgb(palette.cyan),
    model: rgb(palette.yellow), worktree: rgb(palette.purple),
    prompt: `1;${rgb(palette.text)}`, dim: rgb(palette.dim),
    green: rgb(palette.green), yellow: rgb(palette.yellow), red: rgb(palette.red),
    accents: [palette.cyan, palette.purple, palette.blue, palette.yellow, palette.green, palette.red].map(rgb),
  };
}

const THEME_CODES: Record<Theme, ThemeCodes> = {
  default: colorTheme({
    text: '#c0caf5', dim: '#8b90a8', cyan: '#7dcfff', purple: '#bb9af7',
    blue: '#7aa2f7', yellow: '#e0af68', green: '#9ece6a', red: '#f7768e',
  }),
  minimal: {
    focus: '1', branch: '2', model: '2', worktree: '2',
    prompt: '', dim: '2',
    green: '2', yellow: '1', red: '1;7',
    accents: ['2'],
  },
  vivid: {
    focus: '1;96', branch: '96', model: '93', worktree: '95',
    prompt: '1', dim: '90',
    green: '92', yellow: '93', red: '91',
    accents: ['96', '95', '94', '93', '92', '91'],
  },
  light: colorTheme({
    text: '#343b58', dim: '#626b87', cyan: '#006c86', purple: '#7847a1',
    blue: '#2458a6', yellow: '#925500', green: '#3f6818', red: '#b83251',
  }),
};

function buildTheme(codes: ThemeCodes): ThemeColors {
  return {
    focus: mk(codes.focus),
    branch: mk(codes.branch),
    model: mk(codes.model),
    worktree: mk(codes.worktree),
    prompt: mk(codes.prompt),
    dim: mk(codes.dim),
    green: mk(codes.green),
    yellow: mk(codes.yellow),
    red: mk(codes.red),
    accents: codes.accents.map(mk),
  };
}

const THEMES: Record<Theme, ThemeColors> = {
  default: buildTheme(THEME_CODES.default),
  minimal: buildTheme(THEME_CODES.minimal),
  vivid: buildTheme(THEME_CODES.vivid),
  light: buildTheme(THEME_CODES.light),
};

const NO_COLOR_THEME: ThemeColors = buildTheme({
  focus: '', branch: '', model: '', worktree: '', prompt: '', dim: '',
  green: '', yellow: '', red: '', accents: [''],
});

export function getThemeColors(theme: Theme): ThemeColors {
  if (process.env['NO_COLOR'] !== undefined) return NO_COLOR_THEME;
  return THEMES[theme] ?? THEMES.default;
}

function isTheme(x: unknown): x is Theme {
  return typeof x === 'string' && (VALID_THEMES as readonly string[]).includes(x);
}

function mapLegacySlot(slot: string): string {
  return slot === 'purpose' ? 'focus' : slot;
}

function sanitizeLine(raw: unknown, valid: string[], fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const mapped = raw.map((s) => (typeof s === 'string' ? mapLegacySlot(s) : ''));
  return [...new Set(mapped.filter((s) => valid.includes(s)))];
}

function sanitizeGitStatus(raw: unknown): GitStatusConfig {
  const def = DEFAULT_CONFIG.gitStatus;
  if (!raw || typeof raw !== 'object') return { ...def };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: typeof obj['enabled'] === 'boolean' ? obj['enabled'] : def.enabled,
    showDirty: typeof obj['showDirty'] === 'boolean' ? obj['showDirty'] : def.showDirty,
    showAheadBehind: typeof obj['showAheadBehind'] === 'boolean' ? obj['showAheadBehind'] : def.showAheadBehind,
  };
}

export function detectBackgroundTheme(): 'default' | 'light' {
  const cfb = process.env['COLORFGBG'];
  if (!cfb) return 'default';
  const parts = cfb.split(';');
  const bg = parseInt(parts[parts.length - 1] ?? '', 10);
  if (isNaN(bg)) return 'default';
  return bg === 7 || bg === 15 ? 'light' : 'default';
}

export function readConfig(): StatuslineConfig {
  const fallbackTheme = detectBackgroundTheme();
  try {
    const configPath = join(getClaudeConfigDir(), 'claude-recall', 'config.json');
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const requested = parsed['theme'];
    const line3 = sanitizeLine(parsed['line3'], VALID_LINE3, DEFAULT_CONFIG.line3);
    // Legacy: 'context' moved from L2 to L3 in v6.1.0 — migrate if user had it in L2.
    const rawL2 = parsed['line2'];
    if (parsed['line3'] === undefined && Array.isArray(rawL2) && rawL2.includes('context') && !line3.includes('context')) {
      line3.unshift('context');
    }
    const rawSep = parsed['separator'];
    const separator = typeof rawSep === 'string' ? rawSep : DEFAULT_CONFIG.separator;
    return {
      line1: sanitizeLine(parsed['line1'], VALID_LINE1, DEFAULT_CONFIG.line1),
      line2: sanitizeLine(parsed['line2'], VALID_LINE2, DEFAULT_CONFIG.line2),
      line3,
      gitStatus: sanitizeGitStatus(parsed['gitStatus']),
      theme: isTheme(requested) ? requested : fallbackTheme,
      separator,
      widthReserve: typeof parsed['widthReserve'] === 'number' && Number.isSafeInteger(parsed['widthReserve'])
        && parsed['widthReserve'] >= 0 && parsed['widthReserve'] <= 1_000
        ? parsed['widthReserve'] : DEFAULT_CONFIG.widthReserve,
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      gitStatus: { ...DEFAULT_CONFIG.gitStatus },
      theme: fallbackTheme,
    };
  }
}
