import { readStdin } from '../stdin.js';
import { readState, writeState, getBranch } from '../state.js';
import { openSync, statSync, readSync, closeSync } from 'node:fs';

function findCustomTitle(transcriptPath: string): string | null {
  try {
    const fd = openSync(transcriptPath, 'r');
    const size = statSync(transcriptPath).size;
    const readSize = Math.min(size, 32768);
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, Math.max(0, size - readSize));
    closeSync(fd);

    const lines = buf.toString('utf-8').split('\n').reverse();
    for (const line of lines) {
      if (line.includes('custom-title')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'custom-title' && typeof parsed.title === 'string') {
            return parsed.title;
          }
        } catch {
          // not valid JSON, skip
        }
      }
    }
  } catch {
    // transcript not readable
  }
  return null;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = JSON.parse(raw);

  const sessionId: string = input.session_id;
  const prompt: string = input.user_prompt ?? input.prompt ?? '';
  const cwd: string = input.cwd ?? process.cwd();
  const transcriptPath: string = input.transcript_path ?? '';

  const now = new Date().toISOString();
  let state = readState(sessionId);

  if (!state) {
    state = {
      sessionId,
      pid: process.ppid,
      purpose: '',
      purposeSource: 'auto',
      purposeSetAt: '',
      branch: getBranch(cwd, ''),
      cwd,
      status: 'active',
      promptCount: 0,
      lastUserPrompt: '',
      lastUserPromptAt: '',
      lastActivityAt: now,
      startedAt: now,
      model: '',
    };
  }

  // Slash command filter
  if (prompt.startsWith('/')) {
    state.lastActivityAt = now;
    writeState(sessionId, state);
    process.stdout.write('{}\n');
    return;
  }

  // Normal prompt
  state.promptCount++;
  state.lastUserPrompt = prompt.slice(0, 200).replace(/[\n\t\r]/g, ' ');
  state.lastUserPromptAt = now;
  state.lastActivityAt = now;

  // Auto-purpose on first prompt only
  if (state.promptCount === 1 && state.purposeSource !== 'manual') {
    state.purpose = prompt.slice(0, 60).replace(/[\n\t\r]/g, ' ');
    state.purposeSource = 'auto';
    state.purposeSetAt = now;
  }

  // Custom-title from transcript
  if (transcriptPath && state.purposeSource !== 'manual') {
    const customTitle = findCustomTitle(transcriptPath);
    if (customTitle) {
      state.purpose = customTitle;
      state.purposeSource = 'rename';
      state.purposeSetAt = now;
    }
  }

  // Branch
  state.branch = getBranch(cwd, state.branch);

  writeState(sessionId, state);
  process.stdout.write('{}\n');
}

main().catch(() => {
  process.stdout.write('{}\n');
});
