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
    const maxScan = Math.min(lines.length, 100);
    for (let i = 0; i < maxScan; i++) {
      const line = lines[i];
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
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write('{}\n');
    return;
  }

  const sessionId = input.session_id as string;
  const prompt = ((input.user_prompt ?? input.prompt ?? '') as string);
  const cwd = ((input.cwd ?? process.cwd()) as string);
  const transcriptPath = ((input.transcript_path ?? '') as string);

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

  // Refresh branch every 10 prompts (git call is expensive)
  if (state.promptCount % 10 === 1 || !state.branch) {
    state.branch = getBranch(cwd, state.branch);
  }

  writeState(sessionId, state);
  process.stdout.write('{}\n');
}

main().catch(() => {
  process.stdout.write('{}\n');
});
