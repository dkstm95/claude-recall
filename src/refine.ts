import { spawn } from 'node:child_process';
import { readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensurePrivateDir } from './json-file.js';
import { resolveVerifiedPinnedClaudeExecutable } from './claude-runtime.js';
import { getRecallDir } from './paths.js';
import { updateState, type RefinementError, type SessionState } from './state.js';
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

export function isRefiningSubprocess(): boolean {
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

type RefineResult =
  | { status: 'ok'; focus: string; durationMs: number; transcriptBytes: number }
  | { status: 'skip' }
  | {
      status: 'error';
      code: RefinementError['code'];
      durationMs: number;
      transcriptBytes: number;
      stdoutBytes: number;
      stderrTail?: string;
    };

const ERROR_TAIL_CHARS = 500;
// Caps protect against a rogue `claude -p` streaming unbounded output across
// the timeout window. stderr keeps its tail (where error messages usually land).
// stdout keeps its head (Haiku's focus label is the first ~60 chars).
const STDERR_MAX_BUF = 8_000;
const STDOUT_MAX_BUF = 4_000;

export function shouldRefine(lastRefinedAt: string | null): boolean {
  if (!lastRefinedAt) return true;
  const elapsed = Date.now() - new Date(lastRefinedAt).getTime();
  // A future timestamp can result from clock rollback or corrupted legacy
  // state; treating it as permanently debounced would suppress refinement
  // until wall time caught up.
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= DEBOUNCE_MS;
}

function utf8Tail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  let start = Math.max(0, buf.length - maxBytes);
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start += 1;
  return buf.subarray(start).toString('utf8');
}

// Read at most 1 MiB to recover complete JSONL records, then bound the text
// sent to the model. Tool payloads cannot crowd out all recent dialogue.
export async function readTranscriptTail(path: string): Promise<string> {
  const fd = await open(path, 'r');
  try {
    const { size } = await fd.stat();
    const start = Math.max(0, size - 1_048_576);
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fd.read(buf, 0, buf.length, start);
    const decoded = buf.subarray(0, bytesRead).toString('utf-8');
    const firstNewline = decoded.indexOf('\n');
    const text = start > 0 ? (firstNewline >= 0 ? decoded.slice(firstNewline + 1) : '') : decoded;
    const records: string[] = [];
    let jsonRecords = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && typeof record === 'object') jsonRecords += 1;
        const message = record?.message;
        if (record?.type !== 'user' && record?.type !== 'assistant') continue;
        const content = message?.content;
        const pieces = typeof content === 'string' ? [content]
          : Array.isArray(content) ? content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text) : [];
        if (pieces.length) records.push(`${record.type}: ${utf8Tail(pieces.join('\n'), 6_000)}`);
      } catch { /* Legacy plain-text transcripts are handled below. */ }
    }
    if (jsonRecords) return utf8Tail(records.join('\n'), TRANSCRIPT_TAIL_BYTES);
    // Preserve compatibility with plain-text input without cutting UTF-8 bytes.
    const tail = utf8Tail(text, TRANSCRIPT_TAIL_BYTES);
    const nl = tail.indexOf('\n');
    return text.length > tail.length && nl >= 0 && tail.slice(nl + 1).trim() ? tail.slice(nl + 1) : tail;
  } finally {
    await fd.close();
  }
}

export function classifyError(exitCode: number | null, diagnostic: string): RefinementError['code'] {
  if (exitCode === null) return 'unknown';
  if (/rate.?limit|429|too many requests/i.test(diagnostic)) return 'rate_limit';
  if (/auth|401|403|unauthori[sz]ed|credential|not logged in|login required/i.test(diagnostic)) return 'auth';
  return 'unknown';
}

export function classifySpawnError(code: string | undefined): RefinementError['code'] {
  return code && new Set(['ENOENT', 'EACCES', 'ENOEXEC', 'ENOTDIR', 'EPERM']).has(code)
    ? 'setup_required'
    : 'unknown';
}

function diagnosticTail(diagnostic: string): string | undefined {
  const trimmed = diagnostic.trim();
  if (!trimmed) return undefined;
  return trimmed.length > ERROR_TAIL_CHARS ? trimmed.slice(-ERROR_TAIL_CHARS) : trimmed;
}

export function refinementArgs(): string[] {
  return [
    '-p',
    '--model=haiku',
    '--output-format=text',
    '--tools', '',
    '--setting-sources', '',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--system-prompt', SYSTEM_PROMPT,
  ];
}

export async function spawnRefinement(
  transcript: string,
  currentFocus: string,
  options: { claudeExecutable?: string } = {},
): Promise<RefineResult> {
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
  let childCwd: string | undefined;
  try {
    childCwd = getRecallDir();
    ensurePrivateDir(childCwd);
  } catch {
    childCwd = undefined;
  }

  return new Promise<RefineResult>((resolve) => {
    const args = refinementArgs();

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
    let forceKillTimer: NodeJS.Timeout | undefined;

    const errorResult = (code: RefinementError['code']): RefineResult => ({
      status: 'error',
      code,
      durationMs: Date.now() - startedAt,
      transcriptBytes,
      stdoutBytes: Buffer.byteLength(stdout, 'utf-8'),
      stderrTail: diagnosticTail([stderr.trim(), stdout.trim()].filter(Boolean).join('\n')),
    });

    const signalChild = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already exited */ }
    };

    const finish = (result: RefineResult, terminate = false) => {
      if (settled) return;
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
    child.stdout.on('data', (d: string) => {
      if (stdout.length < STDOUT_MAX_BUF) stdout = (stdout + d).slice(0, STDOUT_MAX_BUF);
    });
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-STDERR_MAX_BUF);
    });
    child.stdin.on('error', () => { /* child may reject stdin after an early exit */ });
    child.stdin.end(userPrompt);
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(errorResult(classifySpawnError(error.code)));
    });
    child.on('close', (exitCode) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settled) return;
      if (exitCode !== 0) {
        finish(errorResult(classifyError(exitCode, `${stderr}\n${stdout}`)));
        return;
      }
      const cleanedFocus = sanitizeTerminalText(stdout
        .trim()
        .replace(/^["'`]|["'`]$/g, '')
      );
      const focus = graphemes(cleanedFocus).slice(0, FOCUS_MAX_CHARS).join('').trim();
      if (!focus) {
        finish(errorResult('unknown'));
        return;
      }
      finish({ status: 'ok', focus, durationMs: Date.now() - startedAt, transcriptBytes });
    });
  });
}

export async function triggerFocusRefinement(
  sessionId: string,
  transcriptPath: string | undefined,
  preferredTranscript?: string,
  options: { claudeExecutable?: string; milestone?: boolean } = {},
): Promise<void> {
  if (isRefiningSubprocess()) return;

  if (options.milestone || preferredTranscript?.trim()) {
    await updateState(sessionId, (current) => {
      if (!current) return { value: undefined };
      current.pendingRefinement = {
        transcriptPath: transcriptPath ?? current.pendingRefinement?.transcriptPath,
        summary: preferredTranscript?.trim() ? preferredTranscript.slice(0, PREFERRED_TRANSCRIPT_MAX_CHARS) : current.pendingRefinement?.summary,
      };
      return { state: current, value: undefined };
    });
  }
  let routineRequest = !options.milestone && !preferredTranscript?.trim();
  while (true) {
    const attemptId = randomUUID();
    const attemptStartedAt = new Date().toISOString();
    const decision = await updateState<
      | { kind: 'stop' }
      | { kind: 'wait'; ms: number }
      | { kind: 'run'; currentFocus: string; lastUserPrompt: string; previousRefinedAt: string | null; transcriptPath?: string; summary?: string }
    >(sessionId, (current) => {
      if (!current) return { value: { kind: 'stop' as const } };
      if (!shouldStartRefinement(current)) {
        const leaseAge = current.lastRefinedAt ? Date.now() - Date.parse(current.lastRefinedAt) : Infinity;
        const active = current.refinementAttemptId && leaseAge >= 0 && leaseAge < REFINEMENT_LEASE_MS;
        if (!current.pendingRefinement) return { value: { kind: 'stop' as const } };
        if (active) return { value: { kind: 'wait' as const, ms: Math.min(1_000, REFINEMENT_LEASE_MS - leaseAge) } };
        return { value: { kind: 'wait' as const, ms: Math.max(1, DEBOUNCE_MS - leaseAge) } };
      }
      if (!routineRequest && !current.pendingRefinement) return { value: { kind: 'stop' as const } };
      const pending = current.pendingRefinement;
      current.pendingRefinement = undefined;
      const previousRefinedAt = current.lastRefinedAt;
      current.lastRefinedAt = attemptStartedAt;
      current.refinementAttemptId = attemptId;
      return {
        state: current,
        value: { kind: 'run' as const, currentFocus: current.focus, lastUserPrompt: current.lastUserPrompt,
          previousRefinedAt, transcriptPath: pending?.transcriptPath ?? transcriptPath, summary: pending?.summary },
      };
    });
    if (decision.kind === 'stop') return;
    if (decision.kind === 'wait') { await delay(decision.ms); continue; }
    const claim = decision;
    routineRequest = false;
    transcriptPath = claim.transcriptPath;
    preferredTranscript = claim.summary;

    // Prefer the JSONL transcript tail; fall back to the persisted last user prompt
    // when the file is missing or empty (typical on the first prompt, where Claude
    // Code's transcript flush hasn't completed by the time UserPromptSubmit fires).
    let transcript = preferredTranscript?.trim() ? `Compaction summary:\n${preferredTranscript}` : '';
    if (!transcript && transcriptPath) {
      try {
        transcript = await readTranscriptTail(transcriptPath);
      } catch {
        /* fall through to fallback */
      }
    }
    if (!transcript.trim() && claim.lastUserPrompt.trim()) {
      transcript = `User: ${claim.lastUserPrompt}`;
    }

    const result = await spawnRefinement(transcript, claim.currentFocus, options);
    await updateState(sessionId, (fresh) => {
      // A stale worker must never overwrite a newer claim or its result.
      if (!fresh || fresh.refinementAttemptId !== attemptId) return { value: undefined };

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
      } else {
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
}

function shouldStartRefinement(state: SessionState): boolean {
  if (state.refinementAttemptId && state.lastRefinedAt) {
    const leaseAge = Date.now() - new Date(state.lastRefinedAt).getTime();
    if (Number.isFinite(leaseAge) && leaseAge >= 0 && leaseAge < REFINEMENT_LEASE_MS) return false;
  }
  return shouldRefine(state.lastRefinedAt);
}

/**
 * Launch the refinement as a fully detached worker process.
 * The parent hook returns immediately; the worker outlives it and writes state when done.
 * Outlives this plugin's 10s hook budget and Claude's separate SessionEnd
 * budget; the detached worker owns the 45s refinement timeout.
 */
function writeWorkerInput(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const dir = join(getRecallDir(), 'refine-inputs');
  ensurePrivateDir(getRecallDir());
  ensurePrivateDir(dir);
  // A hard crash between launch and worker startup can strand one input file.
  // Active workers consume theirs immediately and finish within 46s, so files
  // older than ten minutes are unambiguously stale.
  try {
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.txt')) continue;
      const stalePath = join(dir, name);
      if (now - statSync(stalePath).mtimeMs > REFINE_INPUT_MAX_AGE_MS) unlinkSync(stalePath);
    }
  } catch { /* best-effort cleanup */ }
  const path = join(dir, `${randomUUID()}.txt`);
  writeFileSync(path, text.slice(0, PREFERRED_TRANSCRIPT_MAX_CHARS), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return path;
}

export function launchRefinementWorker(
  sessionId: string,
  transcriptPath: string | undefined,
  preferredTranscript?: string,
  milestone = false,
): void {
  if (isRefiningSubprocess()) return;
  if (!sessionId || (!transcriptPath && !preferredTranscript?.trim())) return;

  const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'refine-worker.js');
  let inputPath: string | undefined;
  try {
    inputPath = writeWorkerInput(preferredTranscript);
  } catch {
    inputPath = undefined;
  }

  const cleanupInput = () => {
    if (!inputPath) return;
    try { unlinkSync(inputPath); } catch { /* worker may already have removed it */ }
  };

  try {
    const child = spawn(process.execPath, [workerPath, sessionId, transcriptPath ?? '', inputPath ?? '', milestone ? 'milestone' : ''], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', cleanupInput);
    child.once('exit', cleanupInput);
    child.unref();
  } catch {
    cleanupInput();
  }
}
