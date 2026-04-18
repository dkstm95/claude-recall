import { readStdin } from '../stdin.js';
import { readState, writeState, cleanupOldSessions, getBranch, type SessionState } from '../state.js';

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
  const cwd = (input.cwd ?? process.cwd()) as string;
  const source = (input.source ?? 'startup') as string;
  const now = new Date().toISOString();

  // Clean up completed sessions older than 7 days
  cleanupOldSessions();

  const existing = readState(sessionId);

  if (source === 'startup' || !existing) {
    // New session
    const state: SessionState = {
      sessionId,
      purpose: '',
      purposeSource: 'auto',
      branch: getBranch(cwd, ''),
      cwd,
      promptCount: 0,
      lastUserPrompt: '',
      lastActivityAt: now,
    };
    writeState(sessionId, state);
  } else {
    // Existing session: update common fields
    existing.lastActivityAt = now;
    existing.branch = getBranch(cwd, existing.branch);

    if (source === 'clear') {
      existing.lastUserPrompt = '';
    }

    writeState(sessionId, existing);
  }

  process.stdout.write('{}\n');
}

main().catch((err) => {
  process.stderr.write(`[claude-recall session-start] ${err instanceof Error ? err.message : String(err)}\n`);
  process.stdout.write('{}\n');
});
