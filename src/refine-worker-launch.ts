import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isRefiningSubprocess } from './refine-env.js';

function writeWorkerInput(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const dir = join(homedir(), '.claude', 'claude-recall', 'refine-inputs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.txt`);
  writeFileSync(path, text, 'utf-8');
  return path;
}

/**
 * Launch the refinement as a fully detached worker process.
 * The parent hook returns immediately; the worker outlives it and writes state when done.
 * Required because Claude Code's 10s UserPromptSubmit hook timeout would otherwise SIGHUP
 * the `claude -p` child before Haiku responds (typically 1-5s but up to 30s).
 */
export function launchRefinementWorker(
  sessionId: string,
  transcriptPath: string | undefined,
  preferredTranscript?: string,
): void {
  if (isRefiningSubprocess()) return;
  if (!sessionId || (!transcriptPath && !preferredTranscript?.trim())) return;

  const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'refine-worker.js');
  let inputPath: string | undefined;
  try {
    inputPath = writeWorkerInput(preferredTranscript);
  } catch {
    inputPath = undefined;
  }

  const child = spawn(process.execPath, [workerPath, sessionId, transcriptPath ?? '', inputPath ?? ''], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
