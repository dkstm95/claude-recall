import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
export function readJsonFile(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function writeJsonFileAtomic(path, data) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Session prompts, refinement diagnostics, and quota data are private.
    // Tighten pre-existing directories too; mkdir's mode only applies on create.
    try {
        chmodSync(dir, 0o700);
    }
    catch { /* best effort on non-POSIX filesystems */ }
    const tmp = `${path}.tmp.${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
    });
    renameSync(tmp, path);
}
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
export function withFileLock(path, operation, options = {}) {
    const attempts = options.attempts ?? 100;
    const waitMs = options.waitMs ?? 10;
    const staleMs = options.staleMs ?? 5_000;
    const lockPath = `${path}.lock`;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < attempts; attempt++) {
        let acquired = false;
        try {
            mkdirSync(lockPath, { mode: 0o700 });
            acquired = true;
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                throw err;
            try {
                if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
                    rmSync(lockPath, { recursive: true, force: true });
                    continue;
                }
            }
            catch {
                continue;
            }
            Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, waitMs);
        }
        if (acquired) {
            try {
                return operation();
            }
            finally {
                try {
                    rmSync(lockPath, { recursive: true, force: true });
                }
                catch { /* best effort */ }
            }
        }
    }
    throw new Error(`timed out acquiring file lock: ${path}`);
}
