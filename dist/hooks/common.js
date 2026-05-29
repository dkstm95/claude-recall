import { readStdin } from '../stdin.js';
import { isRefiningSubprocess } from '../refine.js';
export function writeHookResponse() {
    process.stdout.write('{}\n');
}
export function getString(input, key) {
    const value = input[key];
    return typeof value === 'string' ? value : undefined;
}
export async function readHookInput() {
    const raw = await readStdin();
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        // Malformed hook stdin should not fail the Claude Code hook pipeline.
    }
    return null;
}
export async function runHook(label, handler) {
    try {
        if (!isRefiningSubprocess()) {
            const input = await readHookInput();
            if (input)
                await handler(input);
        }
    }
    catch (err) {
        process.stderr.write(`[claude-recall ${label}] ${err instanceof Error ? err.message : String(err)}\n`);
    }
    finally {
        writeHookResponse();
    }
}
