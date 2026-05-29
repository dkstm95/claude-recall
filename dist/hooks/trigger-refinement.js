import { launchRefinementWorker } from '../refine.js';
import { getString, runHook } from './common.js';
async function handleTriggerRefinement(input) {
    const sessionId = getString(input, 'session_id');
    const transcriptPath = getString(input, 'transcript_path');
    if (sessionId && transcriptPath) {
        launchRefinementWorker(sessionId, transcriptPath);
    }
}
await runHook('trigger-refinement', handleTriggerRefinement);
