import { spawn } from 'node:child_process';
import { REFINING_ENV_VALUE, REFINING_ENV_VAR } from './refine-env.js';
// Budget: claude CLI carries a ~9s fixed startup overhead on systems with many
// MCP servers, so 45s leaves Haiku ~36s of headroom — covers observed p99 on
// 12KB transcript inputs.
const TIMEOUT_MS = 45_000;
const FOCUS_MAX_CHARS = 60;
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
            userPrompt,
        ];
        const child = spawn('claude', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
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
            try {
                child.kill('SIGTERM');
            }
            catch { /* ignore */ }
            resolve(result);
        };
        const timer = setTimeout(() => finish(errorResult('timeout')), TIMEOUT_MS);
        child.stdout.on('data', (d) => {
            if (stdout.length < STDOUT_MAX_BUF)
                stdout += d.toString('utf-8');
        });
        child.stderr.on('data', (d) => {
            stderr = (stderr + d.toString('utf-8')).slice(-STDERR_MAX_BUF);
        });
        child.on('error', () => finish(errorResult('unknown')));
        child.on('exit', (exitCode) => {
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
