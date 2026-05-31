import { readState, writeState } from './state.js';
import { isRefiningSubprocess, REFINING_ENV_VALUE, REFINING_ENV_VAR } from './refine-env.js';
import { resolveRefinementTranscript, readTranscriptTail } from './refine-transcript.js';
import { classifyError, spawnRefinement, type RefineResult } from './refine-spawn.js';
import { launchRefinementWorker } from './refine-worker-launch.js';

const DEBOUNCE_MS = 5_000;

export {
  classifyError,
  isRefiningSubprocess,
  launchRefinementWorker,
  readTranscriptTail,
  REFINING_ENV_VALUE,
  REFINING_ENV_VAR,
  spawnRefinement,
};

export function shouldRefine(lastRefinedAt: string | null): boolean {
  if (!lastRefinedAt) return true;
  const elapsed = Date.now() - new Date(lastRefinedAt).getTime();
  return !Number.isFinite(elapsed) || elapsed >= DEBOUNCE_MS;
}

function recordRefinementResult(sessionId: string, result: Exclude<RefineResult, { status: 'skip' }>): void {
  const fresh = readState(sessionId);
  if (!fresh) return;

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
  writeState(sessionId, fresh);
}

export async function triggerFocusRefinement(
  sessionId: string,
  transcriptPath: string | undefined,
  preferredTranscript?: string,
): Promise<void> {
  if (isRefiningSubprocess()) return;

  const state = readState(sessionId);
  if (!state) return;
  if (!shouldRefine(state.lastRefinedAt)) return;

  const transcript = await resolveRefinementTranscript(
    transcriptPath,
    preferredTranscript,
    state.lastUserPrompt,
  );

  // Optimistic write narrows the concurrent-spawn window during the subprocess call.
  const previousRefinedAt = state.lastRefinedAt;
  state.lastRefinedAt = new Date().toISOString();
  writeState(sessionId, state);

  const result = await spawnRefinement(transcript, state.focus);

  if (result.status === 'skip') {
    const fresh = readState(sessionId);
    if (!fresh) return;
    // Roll back the optimistic debounce write — we never actually called Haiku.
    fresh.lastRefinedAt = previousRefinedAt;
    writeState(sessionId, fresh);
    return;
  }

  // Re-read inside recordRefinementResult so fields another hook updated during
  // the spawn window are not clobbered.
  recordRefinementResult(sessionId, result);
}
