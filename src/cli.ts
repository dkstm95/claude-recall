import { listStates } from './state.js';
import { truncate, formatElapsed, displayWidth } from './format.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function padDisplay(text: string, targetWidth: number): string {
  const currentWidth = displayWidth(text);
  const pad = Math.max(0, targetWidth - currentWidth);
  return text + ' '.repeat(pad);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listCommand(): void {
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

  let staleCount = 0;

  for (const s of filtered) {
    let status: string;
    let statusLabel: string;
    if (s.status === 'completed') {
      status = 'completed';
      statusLabel = dim(status);
    } else if (isPidAlive(s.pid)) {
      status = 'active';
      statusLabel = green(status);
    } else {
      status = 'stale';
      statusLabel = yellow(status);
      staleCount++;
    }

    const purpose = padDisplay(truncate(s.purpose || '(no purpose)', 34), 34);
    const branch = padDisplay(truncate(s.branch || '-', 14), 14);
    const count = String(s.promptCount).padStart(2);
    const elapsed = formatElapsed(s.startedAt);

    const statusPadded = statusLabel + ' '.repeat(Math.max(0, 11 - status.length));
    console.log(` ${purpose} ${branch} ${count}  ${statusPadded} ${elapsed}`);
  }

  if (staleCount > 0) {
    console.log('');
    console.log(dim(`  ${staleCount} stale session${staleCount > 1 ? 's' : ''} — from crashed or closed Claude Code instances.`));
    console.log(dim(`  They will be auto-cleaned 7 days after completion.`));
  }
}

function usage(): void {
  console.log(`claude-recall — Session awareness HUD for Claude Code

Usage:
  claude-recall list    Show all tracked sessions`);
}

const command = process.argv[2];

if (command === 'list') {
  listCommand();
} else {
  usage();
}
