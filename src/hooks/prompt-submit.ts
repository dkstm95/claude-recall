import { readState, writeState, refreshGitStatus, createEmptySessionState } from '../state.js';
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
    await refreshGitStatus(state, cwd);
  }

  if (prompt.startsWith('/')) {
    state.lastActivityAt = now;
    writeState(sessionId, state);
    process.stdout.write('{}\n');
    return;
  }

  state.promptCount++;
  state.lastUserPrompt = prompt.slice(0, 200).replace(/[\n\t\r]/g, ' ');
  state.lastActivityAt = now;

  await refreshGitStatus(state, cwd);

  writeState(sessionId, state);

  // Focus refinement at power-of-2 turns (1, 2, 4, 8, 16, 32, ...).
  // Launched as a detached worker so it survives this hook's 10s timeout.
  // First-prompt transcript-flush race is handled inside triggerFocusRefinement.
  if (transcriptPath && isPowerOfTwo(state.promptCount)) {
    launchRefinementWorker(sessionId, transcriptPath);
  }

}

await runHook('prompt-submit', handlePromptSubmit);
