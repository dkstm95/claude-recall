import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const VALID_THEMES = ['default', 'minimal', 'vivid', 'light'];
const DEFAULT_CONFIG = {
    line1: ['focus', 'branch', 'model'],
    line2: ['turn', 'prompt', 'elapsed'],
    line3: ['context', 'rate_limits', 'seven_day', 'cost'],
    gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
    theme: 'default',
};
const VALID_LINE1 = ['focus', 'branch', 'model', 'worktree'];
const VALID_LINE2 = ['turn', 'prompt', 'elapsed'];
const VALID_LINE3 = ['context', 'rate_limits', 'seven_day', 'cost'];
const IDENTITY = (s) => s;
// Empty code string → IDENTITY. A literal \x1b[m would emit a reset, not a no-op.
const mk = (code) => code ? (s) => `\x1b[${code}m${s}\x1b[0m` : IDENTITY;
const THEME_CODES = {
    default: {
        focus: '1;36', branch: '36', model: '33', worktree: '35',
        prompt: '1', dim: '38;5;245',
        green: '32', yellow: '33', red: '31',
        accents: ['36', '35', '34', '33', '32', '31'],
    },
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
    light: {
        focus: '1;34', branch: '34', model: '35', worktree: '35',
        prompt: '1', dim: '38;5;244',
        green: '32', yellow: '38;5;166', red: '31',
        accents: ['36', '35', '34', '32', '31'],
    },
};
function buildTheme(codes) {
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
const THEMES = {
    default: buildTheme(THEME_CODES.default),
    minimal: buildTheme(THEME_CODES.minimal),
    vivid: buildTheme(THEME_CODES.vivid),
    light: buildTheme(THEME_CODES.light),
};
const NO_COLOR_THEME = buildTheme({
    focus: '', branch: '', model: '', worktree: '', prompt: '', dim: '',
    green: '', yellow: '', red: '', accents: [''],
});
export function getThemeColors(theme) {
    if (process.env['NO_COLOR'] !== undefined)
        return NO_COLOR_THEME;
    return THEMES[theme] ?? THEMES.default;
}
function isTheme(x) {
    return typeof x === 'string' && VALID_THEMES.includes(x);
}
function mapLegacySlot(slot) {
    return slot === 'purpose' ? 'focus' : slot;
}
function sanitizeLine(raw, valid, fallback) {
    if (!Array.isArray(raw))
        return fallback;
    const mapped = raw.map((s) => (typeof s === 'string' ? mapLegacySlot(s) : ''));
    return mapped.filter((s) => valid.includes(s));
}
function sanitizeGitStatus(raw) {
    const def = DEFAULT_CONFIG.gitStatus;
    if (!raw || typeof raw !== 'object')
        return { ...def };
    const obj = raw;
    return {
        enabled: typeof obj['enabled'] === 'boolean' ? obj['enabled'] : def.enabled,
        showDirty: typeof obj['showDirty'] === 'boolean' ? obj['showDirty'] : def.showDirty,
        showAheadBehind: typeof obj['showAheadBehind'] === 'boolean' ? obj['showAheadBehind'] : def.showAheadBehind,
    };
}
export function detectBackgroundTheme() {
    const cfb = process.env['COLORFGBG'];
    if (!cfb)
        return 'default';
    const parts = cfb.split(';');
    const bg = parseInt(parts[parts.length - 1] ?? '', 10);
    if (isNaN(bg))
        return 'default';
    return bg === 7 || bg === 15 ? 'light' : 'default';
}
export function readConfig() {
    const fallbackTheme = detectBackgroundTheme();
    try {
        const configPath = join(homedir(), '.claude', 'claude-recall', 'config.json');
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const requested = parsed['theme'];
        const line3 = sanitizeLine(parsed['line3'], VALID_LINE3, DEFAULT_CONFIG.line3);
        // Legacy: 'context' moved from L2 to L3 in v6.1.0 — migrate if user had it in L2.
        const rawL2 = parsed['line2'];
        if (Array.isArray(rawL2) && rawL2.includes('context') && !line3.includes('context')) {
            line3.unshift('context');
        }
        return {
            line1: sanitizeLine(parsed['line1'], VALID_LINE1, DEFAULT_CONFIG.line1),
            line2: sanitizeLine(parsed['line2'], VALID_LINE2, DEFAULT_CONFIG.line2),
            line3,
            gitStatus: sanitizeGitStatus(parsed['gitStatus']),
            theme: isTheme(requested) ? requested : fallbackTheme,
        };
    }
    catch {
        return {
            ...DEFAULT_CONFIG,
            gitStatus: { ...DEFAULT_CONFIG.gitStatus },
            theme: fallbackTheme,
        };
    }
}
