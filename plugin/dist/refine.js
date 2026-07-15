import { spawn } from 'node:child_process';
import { readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensurePrivateDir } from './json-file.js';
import { resolveVerifiedPinnedClaudeExecutable } from './claude-runtime.js';
import { getRecallDir } from './paths.js';
import { updateState } from './state.js';
import { graphemes, sanitizeTerminalText } from './terminal-text.js';
// Budget: claude CLI carries a ~9s fixed startup overhead on systems with many
// MCP servers, so 45s leaves Haiku ~36s of headroom — covers observed p99 on
// 12KB transcript inputs.
const TIMEOUT_MS = 45_000;
const FORCE_KILL_GRACE_MS = 1_000;
const REFINEMENT_LEASE_MS = TIMEOUT_MS + FORCE_KILL_GRACE_MS + 5_000;
// Smaller tail narrows Haiku's processing-time variance without losing enough
// recent context to hurt focus-label accuracy.
const TRANSCRIPT_TAIL_BYTES = 12_000;
const DEBOUNCE_MS = 5_000;
const FOCUS_MAX_CHARS = 60;
const PREFERRED_TRANSCRIPT_MAX_CHARS = 48_000;
const REFINE_INPUT_MAX_AGE_MS = 10 * 60 * 1_000;
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
    // A future timestamp can result from clock rollback or corrupted legacy
    // state; treating it as permanently debounced would suppress refinement
    // until wall time caught up.
    return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= DEBOUNCE_MS;
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
        const { bytesRead } = await fd.read(buf, 0, length, start);
        const text = buf.subarray(0, bytesRead).toString('utf-8');
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
export function classifySpawnError(code) {
    return code && new Set(['ENOENT', 'EACCES', 'ENOEXEC', 'ENOTDIR', 'EPERM']).has(code)
        ? 'setup_required'
        : 'unknown';
}
function stderrTail(stderr) {
    const trimmed = stderr.trim();
    if (!trimmed)
        return undefined;
    return trimmed.length > STDERR_TAIL_CHARS ? trimmed.slice(-STDERR_TAIL_CHARS) : trimmed;
}
export async function spawnRefinement(transcript, currentFocus, options = {}) {
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
    const claudeExecutable = options.claudeExecutable ?? await resolveVerifiedPinnedClaudeExecutable();
    if (!claudeExecutable) {
        return {
            status: 'error',
            code: 'setup_required',
            durationMs: Date.now() - startedAt,
            transcriptBytes,
            stdoutBytes: 0,
            stderrTail: 'Run /claude-recall:setup to pin a verified Claude Code executable.',
        };
    }
    let childCwd;
    try {
        childCwd = getRecallDir();
        ensurePrivateDir(childCwd);
    }
    catch {
        childCwd = undefined;
    }
    return new Promise((resolve) => {
        const args = [
            '-p',
            '--model=haiku',
            '--output-format=text',
            '--tools', '',
            '--setting-sources', '',
            '--settings', JSON.stringify({ disableAllHooks: true }),
            '--strict-mcp-config',
            '--mcp-config', '{}',
            '--disable-slash-commands',
            '--no-session-persistence',
            '--system-prompt', SYSTEM_PROMPT,
        ];
        const child = spawn(claudeExecutable, args, {
            shell: false,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: childCwd,
            env: { ...process.env, [REFINING_ENV_VAR]: REFINING_ENV_VALUE },
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let forceKillTimer;
        const errorResult = (code) => ({
            status: 'error',
            code,
            durationMs: Date.now() - startedAt,
            transcriptBytes,
            stdoutBytes: Buffer.byteLength(stdout, 'utf-8'),
            stderrTail: stderrTail(stderr),
        });
        const signalChild = (signal) => {
            try {
                if (process.platform !== 'win32' && child.pid)
                    process.kill(-child.pid, signal);
                else
                    child.kill(signal);
            }
            catch { /* already exited */ }
        };
        const finish = (result, terminate = false) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (terminate) {
                // Closing our pipe handles prevents a surviving Windows descendant
                // from keeping the detached worker alive after the direct child dies.
                child.stdin.destroy();
                child.stdout.destroy();
                child.stderr.destroy();
                signalChild('SIGTERM');
                forceKillTimer = setTimeout(() => signalChild('SIGKILL'), FORCE_KILL_GRACE_MS);
                forceKillTimer.unref();
            }
            resolve(result);
        };
        const timer = setTimeout(() => finish(errorResult('timeout'), true), TIMEOUT_MS);
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (d) => {
            if (stdout.length < STDOUT_MAX_BUF)
                stdout = (stdout + d).slice(0, STDOUT_MAX_BUF);
        });
        child.stderr.on('data', (d) => {
            stderr = (stderr + d).slice(-STDERR_MAX_BUF);
        });
        child.stdin.on('error', () => { });
        child.stdin.end(userPrompt);
        child.on('error', (error) => {
            finish(errorResult(classifySpawnError(error.code)));
        });
        child.on('close', (exitCode) => {
            if (forceKillTimer)
                clearTimeout(forceKillTimer);
            if (settled)
                return;
            if (exitCode !== 0) {
                finish(errorResult(classifyError(exitCode, stderr)));
                return;
            }
            const cleanedFocus = sanitizeTerminalText(stdout
                .trim()
                .replace(/^["'`]|["'`]$/g, ''));
            const focus = graphemes(cleanedFocus).slice(0, FOCUS_MAX_CHARS).join('').trim();
            if (!focus) {
                finish(errorResult('unknown'));
                return;
            }
            finish({ status: 'ok', focus, durationMs: Date.now() - startedAt, transcriptBytes });
        });
    });
}
export async function triggerFocusRefinement(sessionId, transcriptPath, preferredTranscript, options = {}) {
    if (isRefiningSubprocess())
        return;
    const attemptId = randomUUID();
    const attemptStartedAt = new Date().toISOString();
    const claim = await updateState(sessionId, (current) => {
        if (!current || !shouldStartRefinement(current)) {
            return { value: null };
        }
        const previousRefinedAt = current.lastRefinedAt;
        current.lastRefinedAt = attemptStartedAt;
        current.refinementAttemptId = attemptId;
        return {
            state: current,
            value: {
                currentFocus: current.focus,
                lastUserPrompt: current.lastUserPrompt,
                previousRefinedAt,
            },
        };
    });
    if (!claim)
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
    if (!transcript.trim() && claim.lastUserPrompt.trim()) {
        transcript = `User: ${claim.lastUserPrompt}`;
    }
    const result = await spawnRefinement(transcript, claim.currentFocus, options);
    await updateState(sessionId, (fresh) => {
        // A stale worker must never overwrite a newer claim or its result.
        if (!fresh || fresh.refinementAttemptId !== attemptId)
            return { value: undefined };
        if (result.status === 'skip') {
            fresh.lastRefinedAt = claim.previousRefinedAt;
            fresh.refinementAttemptId = null;
            return { state: fresh, value: undefined };
        }
        const now = new Date().toISOString();
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
        fresh.refinementAttemptId = null;
        return { state: fresh, value: undefined };
    });
}
function shouldStartRefinement(state) {
    if (state.refinementAttemptId && state.lastRefinedAt) {
        const leaseAge = Date.now() - new Date(state.lastRefinedAt).getTime();
        if (Number.isFinite(leaseAge) && leaseAge >= 0 && leaseAge < REFINEMENT_LEASE_MS)
            return false;
    }
    return shouldRefine(state.lastRefinedAt);
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
    const dir = join(getRecallDir(), 'refine-inputs');
    ensurePrivateDir(getRecallDir());
    ensurePrivateDir(dir);
    // A hard crash between launch and worker startup can strand one input file.
    // Active workers consume theirs immediately and finish within 46s, so files
    // older than ten minutes are unambiguously stale.
    try {
        const now = Date.now();
        for (const name of readdirSync(dir)) {
            if (!name.endsWith('.txt'))
                continue;
            const stalePath = join(dir, name);
            if (now - statSync(stalePath).mtimeMs > REFINE_INPUT_MAX_AGE_MS)
                unlinkSync(stalePath);
        }
    }
    catch { /* best-effort cleanup */ }
    const path = join(dir, `${randomUUID()}.txt`);
    writeFileSync(path, text.slice(0, PREFERRED_TRANSCRIPT_MAX_CHARS), {
        encoding: 'utf-8',
        mode: 0o600,
    });
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
    const cleanupInput = () => {
        if (!inputPath)
            return;
        try {
            unlinkSync(inputPath);
        }
        catch { /* worker may already have removed it */ }
    };
    try {
        const child = spawn(process.execPath, [workerPath, sessionId, transcriptPath ?? '', inputPath ?? ''], {
            detached: true,
            stdio: 'ignore',
        });
        child.once('error', cleanupInput);
        child.once('exit', cleanupInput);
        child.unref();
    }
    catch {
        cleanupInput();
    }
}
