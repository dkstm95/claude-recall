import { readStdin } from '../stdin.js';
import { readState, writeState, getBranch } from '../state.js';
import { openSync, statSync, readSync, closeSync } from 'node:fs';
function findCustomTitle(transcriptPath) {
    try {
        const fd = openSync(transcriptPath, 'r');
        const size = statSync(transcriptPath).size;
        const readSize = Math.min(size, 32768);
        const buf = Buffer.alloc(readSize);
        readSync(fd, buf, 0, readSize, Math.max(0, size - readSize));
        closeSync(fd);
        const lines = buf.toString('utf-8').split('\n').reverse();
        const maxScan = Math.min(lines.length, 100);
        for (let i = 0; i < maxScan; i++) {
            const line = lines[i];
            if (line.includes('custom-title')) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'custom-title' && typeof parsed.title === 'string') {
                        return parsed.title;
                    }
                }
                catch {
                    // not valid JSON, skip
                }
            }
        }
    }
    catch {
        // transcript not readable
    }
    return null;
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
    const prompt = (input.user_prompt ?? input.prompt ?? '');
    const cwd = (input.cwd ?? process.cwd());
    const transcriptPath = (input.transcript_path ?? '');
    const now = new Date().toISOString();
    let state = readState(sessionId);
    if (!state) {
        state = {
            sessionId,
            pid: process.ppid,
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
            model: '',
        };
    }
    // Slash command filter
    if (prompt.startsWith('/')) {
        state.lastActivityAt = now;
        writeState(sessionId, state);
        process.stdout.write('{}\n');
        return;
    }
    // Normal prompt
    state.promptCount++;
    state.lastUserPrompt = prompt.slice(0, 200).replace(/[\n\t\r]/g, ' ');
    state.lastUserPromptAt = now;
    state.lastActivityAt = now;
    // Auto-purpose: set on first prompt, refine at prompt #3 if current is longer
    if (state.purposeSource !== 'manual') {
        const candidate = prompt.slice(0, 60).replace(/[\n\t\r]/g, ' ');
        if (state.promptCount === 1) {
            state.purpose = candidate;
            state.purposeSource = 'auto';
            state.purposeSetAt = now;
        }
        else if (state.promptCount === 3 && state.purposeSource === 'auto' && candidate.length > state.purpose.length) {
            state.purpose = candidate;
            state.purposeSetAt = now;
        }
    }
    // Custom-title from transcript
    if (transcriptPath && state.purposeSource !== 'manual') {
        const customTitle = findCustomTitle(transcriptPath);
        if (customTitle) {
            state.purpose = customTitle;
            state.purposeSource = 'rename';
            state.purposeSetAt = now;
        }
    }
    // Refresh branch every 10 prompts (git call is expensive)
    if (state.promptCount % 10 === 1 || !state.branch) {
        state.branch = getBranch(cwd, state.branch);
    }
    writeState(sessionId, state);
    process.stdout.write('{}\n');
}
main().catch(() => {
    process.stdout.write('{}\n');
});
