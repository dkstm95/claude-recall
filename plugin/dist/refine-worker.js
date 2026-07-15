import { triggerFocusRefinement } from './refine.js';
import { readFile, unlink } from 'node:fs/promises';
async function readPreferredTranscript(path) {
    if (!path)
        return undefined;
    try {
        return await readFile(path, 'utf-8');
    }
    catch {
        return undefined;
    }
    finally {
        try {
            await unlink(path);
        }
        catch { /* best-effort cleanup */ }
    }
}
async function main() {
    const sessionId = process.argv[2];
    const transcriptPath = process.argv[3];
    const preferredTranscriptPath = process.argv[4];
    if (!sessionId || (!transcriptPath && !preferredTranscriptPath))
        process.exit(0);
    const preferredTranscript = await readPreferredTranscript(preferredTranscriptPath);
    await triggerFocusRefinement(sessionId, transcriptPath || undefined, preferredTranscript);
}
main().catch((err) => {
    process.stderr.write(`[claude-recall refine-worker] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
});
