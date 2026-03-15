import { listStates } from './state.js';
import { truncate, formatElapsed } from './format.js';
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function listCommand() {
    const states = listStates();
    // Filter out sessions with no prompts
    const filtered = states.filter(s => s.promptCount > 0);
    if (filtered.length === 0) {
        console.log('No sessions found.');
        return;
    }
    // Sort by startedAt descending
    filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    // Header
    const header = ` ${'PURPOSE'.padEnd(34)} ${'BRANCH'.padEnd(14)} ${'#'.padStart(2)}  ${'STATUS'.padEnd(11)} ELAPSED`;
    console.log(dim(header));
    for (const s of filtered) {
        let status;
        let statusLabel;
        if (s.status === 'completed') {
            status = 'completed';
            statusLabel = dim(status);
        }
        else if (isPidAlive(s.pid)) {
            status = 'active';
            statusLabel = green(status);
        }
        else {
            status = 'stale';
            statusLabel = yellow(status);
        }
        const purpose = truncate(s.purpose || '(no purpose)', 34).padEnd(34);
        const branch = truncate(s.branch || '-', 14).padEnd(14);
        const count = String(s.promptCount).padStart(2);
        const elapsed = formatElapsed(s.startedAt);
        console.log(` ${purpose} ${branch} ${count}  ${statusLabel.padEnd(11 + (statusLabel.length - status.length))} ${elapsed}`);
    }
}
function usage() {
    console.log(`claude-recall — Session awareness HUD for Claude Code

Usage:
  claude-recall list    Show all tracked sessions`);
}
const command = process.argv[2];
if (command === 'list') {
    listCommand();
}
else {
    usage();
}
