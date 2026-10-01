import { launchRefinementWorker } from '../refine.js';
import { getString, runHook } from './common.js';
async function handleTriggerRefinement(input) {
    const sessionId = getString(input, 'session_id');
    const transcriptPath = getString(input, 'transcript_path');
    const compactSummary = getString(input, 'compact_summary');
    if (sessionId && (transcriptPath || compactSummary)) {
        launchRefinementWorker(sessionId, transcriptPath, compactSummary, getString(input, 'hook_event_name') !== 'PreCompact');
    }
}
await runHook('trigger-refinement', handleTriggerRefinement);
