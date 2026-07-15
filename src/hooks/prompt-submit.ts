import {
  applyGitStatus,
  createEmptySessionState,
  getGitStatus,
  readState,
  updateState,
} from '../state.js';
import { launchRefinementWorker } from '../refine.js';
import { getString, runHook, type HookInput } from './common.js';

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

async function handlePromptSubmit(input: HookInput): Promise<void> {
  const sessionId = getString(input, 'session_id');
  if (!sessionId) return;

  const prompt = getString(input, 'user_prompt') ?? getString(input, 'prompt') ?? '';
  const cwd = getString(input, 'cwd') ?? process.cwd();
  const transcriptPath = getString(input, 'transcript_path');

  const now = new Date().toISOString();
  if (prompt.startsWith('/')) {
    await updateState(sessionId, (current) => {
      const state = current ?? createEmptySessionState(sessionId, cwd);
      state.cwd = cwd;
      state.lastActivityAt = now;
      return { state, value: undefined };
    });
    return;
  }

  const snapshot = readState(sessionId);
  const cwdChanged = !!snapshot && snapshot.cwd !== '' && snapshot.cwd !== cwd;
  const useFallback = !cwdChanged;
  const gitStatus = await getGitStatus(cwd, useFallback ? snapshot?.gitStatus ?? null : null);
  const promptCount = await updateState(sessionId, (current) => {
    const state = current ?? createEmptySessionState(sessionId, cwd);
    state.cwd = cwd;
    state.promptCount++;
    state.lastUserPrompt = prompt.slice(0, 200).replace(/[\n\t\r]/g, ' ');
    state.lastActivityAt = now;
    applyGitStatus(state, gitStatus, { useFallback });
    return { state, value: state.promptCount };
  });

  // Focus refinement at power-of-2 turns (1, 2, 4, 8, 16, 32, ...).
  // Launched as a detached worker so it survives this hook's 10s timeout.
  // First-prompt transcript-flush race is handled inside triggerFocusRefinement.
  if (transcriptPath && isPowerOfTwo(promptCount)) {
    launchRefinementWorker(sessionId, transcriptPath);
  }

}

await runHook('prompt-submit', handlePromptSubmit);
