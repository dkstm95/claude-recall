import { readStdin } from '../stdin.js';
import { readState, writeState } from '../state.js';

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = JSON.parse(raw);

  const sessionId: string = input.session_id;
  const toolName: string = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};

  const state = readState(sessionId);
  if (!state) {
    process.stdout.write('{}\n');
    return;
  }

  // Track meaningful actions only
  let action = '';
  if (toolName === 'Write' && toolInput.file_path) {
    const file = toolInput.file_path.split('/').slice(-2).join('/');
    action = `Write: ${file}`;
  } else if (toolName === 'Edit' && toolInput.file_path) {
    const file = toolInput.file_path.split('/').slice(-2).join('/');
    action = `Edit: ${file}`;
  } else if (toolName === 'Bash' && toolInput.command) {
    const cmd = toolInput.command.slice(0, 40).replace(/[\n\r]/g, ' ');
    action = `Run: ${cmd}`;
  }

  if (action) {
    state.lastAction = action;
    state.lastActivityAt = new Date().toISOString();
    writeState(sessionId, state);
  }

  process.stdout.write('{}\n');
}

main().catch(() => {
  process.stdout.write('{}\n');
});
