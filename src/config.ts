import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface GitStatusConfig {
  enabled: boolean;
  showDirty: boolean;
  showAheadBehind: boolean;
}

export interface HudConfig {
  line1: string[];
  line2: string[];
  line3: string[];
  gitStatus: GitStatusConfig;
  theme: 'default' | 'minimal' | 'vivid';
}

const DEFAULT_CONFIG: HudConfig = {
  line1: ['focus', 'branch', 'model'],
  line2: ['turn', 'prompt', 'elapsed', 'context'],
  line3: ['rate_limits', 'seven_day', 'cost'],
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
  theme: 'default',
};

const VALID_LINE1 = ['focus', 'branch', 'model', 'worktree'];
const VALID_LINE2 = ['turn', 'prompt', 'elapsed', 'context'];
const VALID_LINE3 = ['rate_limits', 'seven_day', 'cost'];
const VALID_THEMES = ['default', 'minimal', 'vivid'];

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
}

export function getThemeColors(theme: string): ThemeColors {
  switch (theme) {
    case 'minimal':
      return {
        focus: (s) => `\x1b[1m${s}\x1b[0m`,
        branch: (s) => `\x1b[2m${s}\x1b[0m`,
        model: (s) => `\x1b[2m${s}\x1b[0m`,
        worktree: (s) => `\x1b[2m${s}\x1b[0m`,
        prompt: (s) => s,
        dim: (s) => `\x1b[2m${s}\x1b[0m`,
        green: (s) => `\x1b[2m${s}\x1b[0m`,
        yellow: (s) => `\x1b[1m${s}\x1b[0m`,
        red: (s) => `\x1b[1m${s}\x1b[0m`,
      };
    case 'vivid':
      return {
        focus: (s) => `\x1b[1;96m${s}\x1b[0m`,
        branch: (s) => `\x1b[96m${s}\x1b[0m`,
        model: (s) => `\x1b[93m${s}\x1b[0m`,
        worktree: (s) => `\x1b[95m${s}\x1b[0m`,
        prompt: (s) => `\x1b[1;97m${s}\x1b[0m`,
        dim: (s) => `\x1b[90m${s}\x1b[0m`,
        green: (s) => `\x1b[92m${s}\x1b[0m`,
        yellow: (s) => `\x1b[93m${s}\x1b[0m`,
        red: (s) => `\x1b[91m${s}\x1b[0m`,
      };
    default:
      return {
        focus: (s) => `\x1b[1;36m${s}\x1b[0m`,
        branch: (s) => `\x1b[36m${s}\x1b[0m`,
        model: (s) => `\x1b[33m${s}\x1b[0m`,
        worktree: (s) => `\x1b[35m${s}\x1b[0m`,
        prompt: (s) => `\x1b[1m${s}\x1b[0m`,
        dim: (s) => `\x1b[2m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`,
        yellow: (s) => `\x1b[33m${s}\x1b[0m`,
        red: (s) => `\x1b[31m${s}\x1b[0m`,
      };
  }
}

function mapLegacySlot(slot: string): string {
  return slot === 'purpose' ? 'focus' : slot;
}

function sanitizeLine(raw: unknown, valid: string[], fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const mapped = raw.map((s) => (typeof s === 'string' ? mapLegacySlot(s) : ''));
  const filtered = mapped.filter((s) => valid.includes(s));
  return filtered;
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

export function readConfig(): HudConfig {
  try {
    const configPath = join(homedir(), '.claude', 'claude-recall', 'config.json');
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      line1: sanitizeLine(parsed['line1'], VALID_LINE1, DEFAULT_CONFIG.line1),
      line2: sanitizeLine(parsed['line2'], VALID_LINE2, DEFAULT_CONFIG.line2),
      line3: sanitizeLine(parsed['line3'], VALID_LINE3, DEFAULT_CONFIG.line3),
      gitStatus: sanitizeGitStatus(parsed['gitStatus']),
      theme: VALID_THEMES.includes(parsed['theme'] as string)
        ? (parsed['theme'] as HudConfig['theme'])
        : 'default',
    };
  } catch {
    return { ...DEFAULT_CONFIG, gitStatus: { ...DEFAULT_CONFIG.gitStatus } };
  }
}
