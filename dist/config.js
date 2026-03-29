import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const DEFAULT_CONFIG = {
    line1: ['purpose', 'branch', 'model'],
    line2: ['turn', 'prompt', 'elapsed', 'context', 'cost'],
    theme: 'default',
};
const VALID_LINE1 = ['purpose', 'branch', 'model'];
const VALID_LINE2 = ['turn', 'prompt', 'elapsed', 'context', 'cost'];
const VALID_THEMES = ['default', 'minimal', 'vivid'];
export function getThemeColors(theme) {
    switch (theme) {
        case 'minimal':
            return {
                purpose: (s) => `\x1b[1m${s}\x1b[0m`, // bold only
                branch: (s) => `\x1b[2m${s}\x1b[0m`, // dim
                model: (s) => `\x1b[2m${s}\x1b[0m`, // dim
                prompt: (s) => s, // plain
                dim: (s) => `\x1b[2m${s}\x1b[0m`,
                green: (s) => `\x1b[2m${s}\x1b[0m`, // dim (no color)
                yellow: (s) => `\x1b[1m${s}\x1b[0m`, // bold
                red: (s) => `\x1b[1m${s}\x1b[0m`, // bold
            };
        case 'vivid':
            return {
                purpose: (s) => `\x1b[1;96m${s}\x1b[0m`, // bold bright cyan
                branch: (s) => `\x1b[96m${s}\x1b[0m`, // bright cyan
                model: (s) => `\x1b[93m${s}\x1b[0m`, // bright yellow
                prompt: (s) => `\x1b[1;97m${s}\x1b[0m`, // bold bright white
                dim: (s) => `\x1b[90m${s}\x1b[0m`, // bright black
                green: (s) => `\x1b[92m${s}\x1b[0m`, // bright green
                yellow: (s) => `\x1b[93m${s}\x1b[0m`, // bright yellow
                red: (s) => `\x1b[91m${s}\x1b[0m`, // bright red
            };
        default:
            return {
                purpose: (s) => `\x1b[1;36m${s}\x1b[0m`, // bold cyan
                branch: (s) => `\x1b[36m${s}\x1b[0m`, // cyan
                model: (s) => `\x1b[33m${s}\x1b[0m`, // yellow
                prompt: (s) => `\x1b[1m${s}\x1b[0m`, // bold
                dim: (s) => `\x1b[2m${s}\x1b[0m`,
                green: (s) => `\x1b[32m${s}\x1b[0m`,
                yellow: (s) => `\x1b[33m${s}\x1b[0m`,
                red: (s) => `\x1b[31m${s}\x1b[0m`,
            };
    }
}
export function readConfig() {
    try {
        const configPath = join(homedir(), '.claude', 'claude-recall', 'config.json');
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            line1: Array.isArray(parsed.line1) ? parsed.line1.filter((s) => VALID_LINE1.includes(s)) : DEFAULT_CONFIG.line1,
            line2: Array.isArray(parsed.line2) ? parsed.line2.filter((s) => VALID_LINE2.includes(s)) : DEFAULT_CONFIG.line2,
            theme: VALID_THEMES.includes(parsed.theme) ? parsed.theme : 'default',
        };
    }
    catch {
        return DEFAULT_CONFIG;
    }
}
