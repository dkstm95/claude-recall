import { readStdin } from '../stdin.js';
import { readState, writeState, getBranch } from '../state.js';

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write('{}\n');
    return;
  }

  const sessionId = input.session_id as string;
  const prompt = ((input.user_prompt ?? input.prompt ?? '') as string);
  const cwd = ((input.cwd ?? process.cwd()) as string);

  const now = new Date().toISOString();
  let state = readState(sessionId);

  if (!state) {
    state = {
      sessionId,
      purpose: '',
      purposeSource: 'auto',
      branch: getBranch(cwd, ''),
      cwd,
      promptCount: 0,
      lastUserPrompt: '',
      lastActivityAt: now,
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
  state.lastActivityAt = now;

  // Auto-purpose: set on first prompt, refine at prompt #3 if current is longer
  if (state.purposeSource !== 'manual') {
    const candidate = prompt.slice(0, 60).replace(/[\n\t\r]/g, ' ');
    if (state.promptCount === 1) {
      state.purpose = candidate;
      state.purposeSource = 'auto';
    } else if (state.promptCount === 3 && state.purposeSource === 'auto' && candidate.length > state.purpose.length) {
      state.purpose = candidate;
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
