import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, updateState, type SessionState, type StateUpdate } from '../state.js';
import { readStdin } from '../stdin.js';
import { isRefiningSubprocess } from '../refine.js';

const ACTIVE_PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Record the loaded root in the hook's existing transaction, not a second
// competing write after every prompt in a burst of parallel hook processes.
export function updateHookState<T>(
  sessionId: string,
  updater: (current: SessionState | null) => StateUpdate<T>,
): Promise<T> {
  return updateState(sessionId, (current) => {
    const update = updater(current);
    if (update.state) update.state.activePluginRoot = ACTIVE_PLUGIN_ROOT;
    return update;
  });
}

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
      if (input) {
        await handler(input);
        const sessionId = getString(input, 'session_id');
        if (sessionId && readState(sessionId)?.activePluginRoot !== ACTIVE_PLUGIN_ROOT) await updateState(sessionId, (state) => {
          if (!state) return { value: undefined };
          if (state.activePluginRoot === ACTIVE_PLUGIN_ROOT) return { value: undefined };
          state.activePluginRoot = ACTIVE_PLUGIN_ROOT;
          return { state, value: undefined };
        });
      }
    }
  } catch (err) {
    process.stderr.write(`[claude-recall ${label}] ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    writeHookResponse();
  }
}
