import { readStdin } from '../stdin.js';
import { launchRefinementWorker, isRefiningSubprocess } from '../refine.js';

async function main(): Promise<void> {
  if (isRefiningSubprocess()) {
    process.stdout.write('{}\n');
    return;
  }

  const raw = await readStdin();
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write('{}\n');
    return;
  }

  const sessionId = input['session_id'] as string | undefined;
  const transcriptPath = input['transcript_path'] as string | undefined;

  if (sessionId && transcriptPath) {
    launchRefinementWorker(sessionId, transcriptPath);
  }

  process.stdout.write('{}\n');
}

main().catch((err) => {
  process.stderr.write(`[claude-recall trigger-refinement] ${err instanceof Error ? err.message : String(err)}\n`);
  process.stdout.write('{}\n');
});
