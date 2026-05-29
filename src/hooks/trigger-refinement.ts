import { launchRefinementWorker } from '../refine.js';
import { getString, runHook, type HookInput } from './common.js';

async function handleTriggerRefinement(input: HookInput): Promise<void> {
  const sessionId = getString(input, 'session_id');
  const transcriptPath = getString(input, 'transcript_path');
  const compactSummary = getString(input, 'compact_summary');

  if (sessionId && (transcriptPath || compactSummary)) {
    launchRefinementWorker(sessionId, transcriptPath, compactSummary);
  }
}

await runHook('trigger-refinement', handleTriggerRefinement);
