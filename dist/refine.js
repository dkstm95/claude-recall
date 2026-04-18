import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readState, writeState } from './state.js';
const TIMEOUT_MS = 30_000;
const TRANSCRIPT_TAIL_BYTES = 20_000;
const DEBOUNCE_MS = 5_000;
const FOCUS_MAX_CHARS = 60;
export const REFINING_ENV_VAR = 'CLAUDE_RECALL_REFINING';
export const REFINING_ENV_VALUE = '1';
export function isRefiningSubprocess() {
    return process.env[REFINING_ENV_VAR] === REFINING_ENV_VALUE;
}
const SYSTEM_PROMPT = [
    'You summarize a Claude Code session into a single concise focus label.',
    '',
    'Rules:',
    '- Output ONLY the focus text. No quotes, no explanation, no prefix, no trailing punctuation.',
    `- Maximum ${FOCUS_MAX_CHARS} characters.`,
    '- Use the SAME LANGUAGE as the transcript (Korean transcript → Korean focus, English → English, etc.).',
    '- Describe what the session is currently trying to accomplish, not historical noise.',
    '- Prefer concrete verbs over vague nouns.',
].join('\n');
export function shouldRefine(lastRefinedAt) {
    if (!lastRefinedAt)
        return true;
    const elapsed = Date.now() - new Date(lastRefinedAt).getTime();
    return !Number.isFinite(elapsed) || elapsed >= DEBOUNCE_MS;
}
async function readTranscriptTail(path) {
    const fd = await open(path, 'r');
    try {
        const stats = await fd.stat();
        const start = Math.max(0, stats.size - TRANSCRIPT_TAIL_BYTES);
        const length = stats.size - start;
        if (length <= 0)
            return '';
        const buf = Buffer.alloc(length);
        await fd.read(buf, 0, length, start);
        const text = buf.toString('utf-8');
        // Drop a possibly-truncated first line only when we actually seeked past byte 0.
        const nl = text.indexOf('\n');
        return nl >= 0 && start > 0 ? text.slice(nl + 1) : text;
    }
    finally {
        await fd.close();
    }
}
function classifyError(exitCode, stderr) {
    if (exitCode === null)
        return 'unknown';
    if (/rate.?limit|429|too many requests/i.test(stderr))
        return 'rate_limit';
    if (/auth|401|403|unauthori[sz]ed|credential/i.test(stderr))
        return 'auth';
    return 'unknown';
}
export async function spawnRefinement(transcriptPath, currentFocus) {
    let transcript = '';
    try {
        transcript = await readTranscriptTail(transcriptPath);
    }
    catch {
        // Transcript file missing — treat as "no data yet" rather than a failure.
        return { status: 'skip' };
    }
    if (!transcript.trim()) {
        return { status: 'skip' };
    }
    const userPrompt = [
        `Current focus: "${currentFocus || '(none)'}"`,
        '',
        'Transcript (recent):',
        transcript,
        '',
        'Respond with the updated focus text only.',
    ].join('\n');
    return new Promise((resolve) => {
        const args = [
            '-p',
            '--model=haiku',
            '--output-format=text',
            '--tools', '',
            '--disable-slash-commands',
            '--no-session-persistence',
            '--append-system-prompt', SYSTEM_PROMPT,
            userPrompt,
        ];
        const child = spawn('claude', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, [REFINING_ENV_VAR]: REFINING_ENV_VALUE },
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                child.kill('SIGTERM');
            }
            catch { /* ignore */ }
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ status: 'error', code: 'timeout' });
        }, TIMEOUT_MS);
        child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
        child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
        child.on('error', () => finish({ status: 'error', code: 'unknown' }));
        child.on('exit', (exitCode) => {
            if (exitCode !== 0) {
                finish({ status: 'error', code: classifyError(exitCode, stderr) });
                return;
            }
            const focus = stdout
                .trim()
                .replace(/^["'`]|["'`]$/g, '')
                .replace(/[\n\t\r]/g, ' ')
                .slice(0, FOCUS_MAX_CHARS)
                .trim();
            if (!focus) {
                finish({ status: 'error', code: 'unknown' });
                return;
            }
            finish({ status: 'ok', focus });
        });
    });
}
export async function triggerFocusRefinement(sessionId, transcriptPath) {
    if (isRefiningSubprocess())
        return;
    const state = readState(sessionId);
    if (!state)
        return;
    if (!shouldRefine(state.lastRefinedAt))
        return;
    // Optimistic write narrows the concurrent-spawn window during the subprocess call.
    const previousRefinedAt = state.lastRefinedAt;
    state.lastRefinedAt = new Date().toISOString();
    writeState(sessionId, state);
    const result = await spawnRefinement(transcriptPath, state.focus);
    // Re-read so we don't clobber fields another hook may have updated during the spawn window.
    const fresh = readState(sessionId);
    if (!fresh)
        return;
    if (result.status === 'skip') {
        // Roll back the optimistic debounce write — we never actually called Haiku.
        fresh.lastRefinedAt = previousRefinedAt;
        writeState(sessionId, fresh);
        return;
    }
    if (result.status === 'ok') {
        fresh.focus = result.focus;
        fresh.refinementError = null;
    }
    else {
        fresh.refinementError = { code: result.code, at: new Date().toISOString() };
    }
    fresh.lastRefinedAt = new Date().toISOString();
    writeState(sessionId, fresh);
}
/**
 * Launch the refinement as a fully detached worker process.
 * The parent hook returns immediately; the worker outlives it and writes state when done.
 * Required because Claude Code's 10s UserPromptSubmit hook timeout would otherwise SIGHUP
 * the `claude -p` child before Haiku responds (typically 1-5s but up to 30s).
 */
export function launchRefinementWorker(sessionId, transcriptPath) {
    if (isRefiningSubprocess())
        return;
    if (!sessionId || !transcriptPath)
        return;
    const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'refine-worker.js');
    const child = spawn(process.execPath, [workerPath, sessionId, transcriptPath], {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
}
