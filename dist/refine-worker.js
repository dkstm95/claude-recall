import { triggerFocusRefinement } from './refine.js';
async function main() {
    const sessionId = process.argv[2];
    const transcriptPath = process.argv[3];
    if (!sessionId || !transcriptPath)
        process.exit(0);
    await triggerFocusRefinement(sessionId, transcriptPath);
}
main().catch((err) => {
    process.stderr.write(`[claude-recall refine-worker] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
});
