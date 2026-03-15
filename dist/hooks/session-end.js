import { readStdin } from '../stdin.js';
import { readState, writeState } from '../state.js';
async function main() {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const sessionId = input.session_id;
    const now = new Date().toISOString();
    const state = readState(sessionId);
    if (state) {
        state.status = 'completed';
        state.lastActivityAt = now;
        writeState(sessionId, state);
    }
    process.stdout.write('{}\n');
}
main().catch(() => {
    process.stdout.write('{}\n');
});
