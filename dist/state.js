import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
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
export function getBranch(cwd, fallback) {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', {
            cwd,
            timeout: 2000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return fallback;
    }
}
const CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export function cleanupOldSessions() {
    const dir = getStateDir();
    const now = Date.now();
    let files;
    try {
        files = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const f of files) {
        if (!f.endsWith('.json') || f.includes('.tmp.'))
            continue;
        try {
            const raw = readFileSync(join(dir, f), 'utf-8');
            const state = JSON.parse(raw);
            if (state.status === 'completed') {
                const age = now - new Date(state.lastActivityAt).getTime();
                if (age > CLEANUP_MAX_AGE_MS) {
                    unlinkSync(join(dir, f));
                }
            }
        }
        catch {
            // skip
        }
    }
}
