import { readStdin } from '../stdin.js';
import { isRefiningSubprocess } from '../refine.js';

export type HookInput = Record<string, unknown>;

export function writeHookResponse(): void {
  process.stdout.write('{}\n');
}

export function getString(input: HookInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export async function readHookInput(): Promise<HookInput | null> {
  const raw = await readStdin();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as HookInput;
    }
  } catch {
    // Malformed hook stdin should not fail the Claude Code hook pipeline.
  }
  return null;
}

export async function runHook(
  label: string,
  handler: (input: HookInput) => Promise<void>,
): Promise<void> {
  try {
    if (!isRefiningSubprocess()) {
      const input = await readHookInput();
      if (input) await handler(input);
    }
  } catch (err) {
    process.stderr.write(`[claude-recall ${label}] ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    writeHookResponse();
  }
}
