import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getStatePath, readState, updateState } from './state.js';
// Budget: claude CLI carries a ~9s fixed startup overhead on systems with many
// MCP servers, so 45s leaves Haiku ~36s of headroom — covers observed p99 on
// 12KB transcript inputs.
const TIMEOUT_MS = 45_000;
// Smaller tail narrows Haiku's processing-time variance without losing enough
// recent context to hurt focus-label accuracy.
const TRANSCRIPT_TAIL_BYTES = 12_000;
const DEBOUNCE_MS = 5_000;
const FOCUS_MAX_CHARS = 60;
const REFINEMENT_LOCK_STALE_MS = TIMEOUT_MS + 15_000;
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
const STDERR_TAIL_CHARS = 500;
// Caps protect against a rogue `claude -p` streaming unbounded output across
// the timeout window. stderr keeps its tail (where error messages usually land).
// stdout keeps its head (Haiku's focus label is the first ~60 chars).
const STDERR_MAX_BUF = 8_000;
const STDOUT_MAX_BUF = 4_000;
export function shouldRefine(lastRefinedAt) {
    if (!lastRefinedAt)
        return true;
    const elapsed = Date.now() - new Date(lastRefinedAt).getTime();
    return !Number.isFinite(elapsed) || elapsed >= DEBOUNCE_MS;
}
export async function readTranscriptTail(path) {
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
export function classifyError(exitCode, stderr) {
    if (exitCode === null)
        return 'unknown';
    if (/rate.?limit|429|too many requests/i.test(stderr))
        return 'rate_limit';
    if (/auth|401|403|unauthori[sz]ed|credential/i.test(stderr))
        return 'auth';
    return 'unknown';
}
function stderrTail(stderr) {
    const trimmed = stderr.trim();
    if (!trimmed)
        return undefined;
    return trimmed.length > STDERR_TAIL_CHARS ? trimmed.slice(-STDERR_TAIL_CHARS) : trimmed;
}
export async function spawnRefinement(transcript, currentFocus) {
    if (!transcript.trim()) {
        return { status: 'skip' };
    }
    const transcriptBytes = Buffer.byteLength(transcript, 'utf-8');
    const userPrompt = [
        `Current focus: "${currentFocus || '(none)'}"`,
        '',
        'Transcript (recent):',
        transcript,
        '',
        'Respond with the updated focus text only.',
    ].join('\n');
    const startedAt = Date.now();
    return new Promise((resolve) => {
        const args = [
            '-p',
            '--model=haiku',
            '--output-format=text',
            '--tools', '',
            '--disable-slash-commands',
            '--no-session-persistence',
            '--append-system-prompt', SYSTEM_PROMPT,
        ];
        const child = spawn('claude', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, [REFINING_ENV_VAR]: REFINING_ENV_VALUE },
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const errorResult = (code) => ({
            status: 'error',
            code,
            durationMs: Date.now() - startedAt,
            transcriptBytes,
            stdoutBytes: Buffer.byteLength(stdout, 'utf-8'),
            stderrTail: stderrTail(stderr),
        });
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (child.exitCode === null && child.signalCode === null) {
                try {
                    child.kill('SIGTERM');
                }
                catch { /* ignore */ }
                const forceKill = setTimeout(() => {
                    try {
                        child.kill('SIGKILL');
                    }
                    catch { /* ignore */ }
                }, 1_000);
                forceKill.unref();
                child.once('close', () => clearTimeout(forceKill));
            }
            resolve(result);
        };
        const timer = setTimeout(() => finish(errorResult('timeout')), TIMEOUT_MS);
        child.stdout.on('data', (d) => {
            if (stdout.length < STDOUT_MAX_BUF) {
                stdout = (stdout + d.toString('utf-8')).slice(0, STDOUT_MAX_BUF);
            }
        });
        child.stderr.on('data', (d) => {
            stderr = (stderr + d.toString('utf-8')).slice(-STDERR_MAX_BUF);
        });
        child.on('error', () => finish(errorResult('unknown')));
        child.stdin.on('error', () => { });
        child.stdin.end(userPrompt);
        child.on('close', (exitCode) => {
            if (exitCode !== 0) {
                finish(errorResult(classifyError(exitCode, stderr)));
                return;
            }
            const focus = stdout
                .trim()
                .replace(/^["'`]|["'`]$/g, '')
                .replace(/[\n\t\r]/g, ' ')
                .slice(0, FOCUS_MAX_CHARS)
                .trim();
            if (!focus) {
                finish(errorResult('unknown'));
                return;
            }
            finish({ status: 'ok', focus, durationMs: Date.now() - startedAt, transcriptBytes });
        });
    });
}
export async function triggerFocusRefinement(sessionId, transcriptPath, preferredTranscript) {
    if (isRefiningSubprocess())
        return;
    const releaseRefinement = tryAcquireRefinementLock(sessionId);
    if (!releaseRefinement)
        return;
    try {
        const state = readState(sessionId);
        if (!state || !shouldRefine(state.lastRefinedAt))
            return;
        // Prefer the JSONL transcript tail; fall back to the persisted last user prompt
        // when the file is missing or empty (typical on the first prompt, where Claude
        // Code's transcript flush hasn't completed by the time UserPromptSubmit fires).
        let transcript = preferredTranscript?.trim() ? `Compaction summary:\n${preferredTranscript}` : '';
        if (!transcript && transcriptPath) {
            try {
                transcript = await readTranscriptTail(transcriptPath);
            }
            catch {
                /* fall through to fallback */
            }
        }
        if (!transcript.trim() && state.lastUserPrompt.trim()) {
            transcript = `User: ${state.lastUserPrompt}`;
        }
        const result = await spawnRefinement(transcript, state.focus);
        if (result.status === 'skip')
            return;
        const now = new Date().toISOString();
        updateState(sessionId, (fresh) => {
            if (result.status === 'ok') {
                fresh.focus = result.focus;
                fresh.refinementError = null;
                fresh.lastRefinement = {
                    at: now,
                    status: 'ok',
                    durationMs: result.durationMs,
                    transcriptBytes: result.transcriptBytes,
                };
            }
            else {
                fresh.refinementError = {
                    code: result.code,
                    at: now,
                    durationMs: result.durationMs,
                    stderrTail: result.stderrTail,
                };
                fresh.lastRefinement = {
                    at: now,
                    status: 'error',
                    code: result.code,
                    durationMs: result.durationMs,
                    transcriptBytes: result.transcriptBytes,
                    stdoutBytes: result.stdoutBytes,
                    stderrTail: result.stderrTail,
                };
            }
            fresh.lastRefinedAt = now;
        });
    }
    finally {
        releaseRefinement();
    }
}
function tryAcquireRefinementLock(sessionId) {
    const lockPath = `${getStatePath(sessionId)}.refining`;
    const acquire = () => {
        try {
            mkdirSync(lockPath, { mode: 0o700 });
            return () => {
                try {
                    rmSync(lockPath, { recursive: true, force: true });
                }
                catch { /* best effort */ }
            };
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                return null;
            return null;
        }
    };
    const first = acquire();
    if (first)
        return first;
    try {
        if (Date.now() - statSync(lockPath).mtimeMs <= REFINEMENT_LOCK_STALE_MS)
            return null;
        rmSync(lockPath, { recursive: true, force: true });
    }
    catch {
        return null;
    }
    return acquire();
}
/**
 * Launch the refinement as a fully detached worker process.
 * The parent hook returns immediately; the worker outlives it and writes state when done.
 * Required because Claude Code's 10s UserPromptSubmit hook timeout would otherwise SIGHUP
 * the `claude -p` child before Haiku responds (typically 1-5s but up to 30s).
 */
function writeWorkerInput(text) {
    if (!text?.trim())
        return undefined;
    const dir = join(homedir(), '.claude', 'claude-recall', 'refine-inputs');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        chmodSync(dir, 0o700);
    }
    catch { /* best effort on non-POSIX filesystems */ }
    const path = join(dir, `${randomUUID()}.txt`);
    writeFileSync(path, text, { encoding: 'utf-8', mode: 0o600 });
    return path;
}
export function launchRefinementWorker(sessionId, transcriptPath, preferredTranscript) {
    if (isRefiningSubprocess())
        return;
    if (!sessionId || (!transcriptPath && !preferredTranscript?.trim()))
        return;
    const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'refine-worker.js');
    let inputPath;
    try {
        inputPath = writeWorkerInput(preferredTranscript);
    }
    catch {
        inputPath = undefined;
    }
    const child = spawn(process.execPath, [workerPath, sessionId, transcriptPath ?? '', inputPath ?? ''], {
        detached: true,
        stdio: 'ignore',
    });
    child.once('error', () => {
        if (inputPath) {
            try {
                unlinkSync(inputPath);
            }
            catch { /* best-effort cleanup */ }
        }
    });
    child.unref();
}
