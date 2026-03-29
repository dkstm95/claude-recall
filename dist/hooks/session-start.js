import { readStdin } from '../stdin.js';
import { readState, writeState, cleanupOldSessions, getBranch } from '../state.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
function findPid(sessionId) {
    // Search Claude's own session files for matching PID
    const sessionsDir = join(homedir(), '.claude', 'sessions');
    try {
        const files = readdirSync(sessionsDir);
        for (const f of files) {
            if (!f.endsWith('.json'))
                continue;
            try {
                const raw = readFileSync(join(sessionsDir, f), 'utf-8');
                const data = JSON.parse(raw);
                if (data.sessionId === sessionId && typeof data.pid === 'number') {
                    return data.pid;
                }
            }
            catch {
                // skip
            }
        }
    }
    catch {
        // dir doesn't exist
    }
    return process.ppid;
}
async function main() {
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        process.stdout.write('{}\n');
        return;
    }
    const sessionId = input.session_id;
    const cwd = (input.cwd ?? process.cwd());
    const source = (input.source ?? 'startup');
    const model = (input.model ?? '');
    const now = new Date().toISOString();
    // Clean up completed sessions older than 7 days
    cleanupOldSessions();
    const existing = readState(sessionId);
    if (source === 'startup' || !existing) {
        // New session
        const state = {
            sessionId,
            pid: findPid(sessionId),
            purpose: '',
            purposeSource: 'auto',
            purposeSetAt: '',
            branch: getBranch(cwd, ''),
            cwd,
            status: 'active',
            promptCount: 0,
            lastUserPrompt: '',
            lastUserPromptAt: '',
            lastActivityAt: now,
            startedAt: now,
            model,
        };
        writeState(sessionId, state);
    }
    else {
        // Existing session: update common fields
        existing.lastActivityAt = now;
        existing.branch = getBranch(cwd, existing.branch);
        existing.status = 'active';
        if (model)
            existing.model = model;
        if (source === 'clear') {
            existing.lastUserPrompt = '';
            existing.lastUserPromptAt = '';
        }
        writeState(sessionId, existing);
    }
    process.stdout.write('{}\n');
}
main().catch(() => {
    process.stdout.write('{}\n');
});
