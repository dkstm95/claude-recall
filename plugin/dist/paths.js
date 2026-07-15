import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
export function getClaudeConfigDir() {
    const configured = process.env['CLAUDE_CONFIG_DIR']?.trim();
    if (!configured)
        return join(homedir(), '.claude');
    if (configured === '~')
        return homedir();
    if (configured.startsWith('~/') || configured.startsWith('~\\')) {
        return join(homedir(), configured.slice(2));
    }
    return isAbsolute(configured) ? configured : resolve(configured);
}
export function getRecallDir() {
    return join(getClaudeConfigDir(), 'claude-recall');
}
