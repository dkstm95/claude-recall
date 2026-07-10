import { readState, updateState, refreshGitStatus, createEmptySessionState } from '../state.js';
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
  let state = readState(sessionId);

  if (!state) {
    state = createEmptySessionState(sessionId, cwd);
  }

  const cwdChanged = state.cwd !== '' && state.cwd !== cwd;
  state.cwd = cwd;

  if (prompt.startsWith('/')) {
    updateState(sessionId, (fresh) => {
      fresh.cwd = cwd;
      fresh.lastActivityAt = now;
    }, state);
    return;
  }

  await refreshGitStatus(state, cwd, { useFallback: !cwdChanged });

  const committed = updateState(sessionId, (fresh) => {
    fresh.cwd = cwd;
    fresh.promptCount++;
    fresh.lastUserPrompt = prompt.slice(0, 200).replace(/[\n\t\r]/g, ' ');
    fresh.lastActivityAt = now;
    fresh.gitStatus = state.gitStatus;
    fresh.branch = state.branch;
  }, state);

  // Focus refinement at power-of-2 turns (1, 2, 4, 8, 16, 32, ...).
  // Launched as a detached worker so it survives this hook's 10s timeout.
  // First-prompt transcript-flush race is handled inside triggerFocusRefinement.
  if (transcriptPath && committed && isPowerOfTwo(committed.promptCount)) {
    launchRefinementWorker(sessionId, transcriptPath);
  }

}

await runHook('prompt-submit', handlePromptSubmit);
