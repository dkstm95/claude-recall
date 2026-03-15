import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
export function getStateDir() {
    const dir = join(homedir(), '.claude', 'claude-recall', 'sessions');
    mkdirSync(dir, { recursive: true });
    return dir;
}
export function getStatePath(sessionId) {
    return join(getStateDir(), `${sessionId}.json`);
}
export function readState(sessionId) {
    try {
        const raw = readFileSync(getStatePath(sessionId), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function writeState(sessionId, state) {
    const target = getStatePath(sessionId);
    const tmp = `${target}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    renameSync(tmp, target);
}
export function listStates() {
    const dir = getStateDir();
    const files = readdirSync(dir);
    const states = [];
    for (const f of files) {
        if (!f.endsWith('.json') || f.includes('.tmp.'))
            continue;
        try {
            const raw = readFileSync(join(dir, f), 'utf-8');
            states.push(JSON.parse(raw));
        }
        catch {
            // skip corrupt files
        }
    }
    return states;
}
