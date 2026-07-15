import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LOCK_RETRY_MS = 5;
// Leave headroom inside Claude Code's 10s hook budget while tolerating a burst
// of many statusline processes contending on the shared account/session caches.
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 60_000;
export function ensurePrivateDir(path) {
    mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
    try {
        chmodSync(path, PRIVATE_DIR_MODE);
    }
    catch { /* best effort on non-POSIX filesystems */ }
}
export function readJsonFile(path) {
    try {
        const raw = readFileSync(path, 'utf-8');
        try {
            chmodSync(path, PRIVATE_FILE_MODE);
        }
        catch { /* best effort */ }
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function writeJsonFileAtomic(path, data) {
    writePrivateFileAtomic(path, JSON.stringify(data, null, 2) + '\n');
}
export function writePrivateFileAtomic(path, data) {
    ensurePrivateDir(dirname(path));
    const tmp = `${path}.tmp.${randomUUID()}`;
    try {
        writeFileSync(tmp, data, { mode: PRIVATE_FILE_MODE });
        try {
            chmodSync(tmp, PRIVATE_FILE_MODE);
        }
        catch { /* best effort */ }
        renameSync(tmp, path);
    }
    catch (err) {
        try {
            unlinkSync(tmp);
        }
        catch { /* best effort */ }
        throw err;
    }
}
function isErrno(err, code) {
    return err instanceof Error && 'code' in err && err.code === code;
}
function delay(ms) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
function parseLockClaim(raw) {
    try {
        const value = JSON.parse(raw);
        if (typeof value.token === 'string'
            && Number.isSafeInteger(value.pid)
            && typeof value.pid === 'number'
            && value.pid > 0
            && typeof value.createdAt === 'number'
            && Number.isFinite(value.createdAt)
            && typeof value.choosing === 'boolean'
            && (value.ticket === null || (typeof value.ticket === 'number'
                && Number.isSafeInteger(value.ticket)
                && value.ticket > 0)))
            return value;
    }
    catch { /* malformed claim */ }
    return null;
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM means the process exists but this account cannot signal it.
        return isErrno(err, 'EPERM');
    }
}
function liveClaims(lockDir, targetKey, ownToken) {
    const claims = [];
    let invalid = false;
    let names;
    try {
        names = readdirSync(lockDir);
    }
    catch {
        return { claims, invalid };
    }
    for (const name of names) {
        const prefix = `${targetKey}.`;
        if (!name.startsWith(prefix) || !name.endsWith('.json'))
            continue;
        const path = join(lockDir, name);
        let claim = null;
        try {
            claim = parseLockClaim(readFileSync(path, 'utf-8'));
        }
        catch { /* handled below */ }
        if (!claim || claim.token !== name.slice(prefix.length, -5)) {
            try {
                if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS)
                    unlinkSync(path);
                else
                    invalid = true;
            }
            catch { /* disappeared */ }
            continue;
        }
        if (claim.token === ownToken)
            continue;
        if (!processIsAlive(claim.pid)) {
            // Claim paths are generation-unique UUIDs. Deleting a dead claim cannot
            // unlink a replacement owner, unlike a shared canonical lock path.
            try {
                unlinkSync(path);
            }
            catch { /* another contender cleaned it */ }
            continue;
        }
        claims.push(claim);
    }
    return { claims, invalid };
}
/**
 * Serialize a short read-modify-write transaction across statusline and hook
 * processes. The callback must stay synchronous so the lock is held for only
 * the local JSON read/write window, never for git or Haiku subprocess work.
 */
export async function withFileLock(targetPath, action, options = {}) {
    const normalizedTarget = resolve(targetPath);
    const lockDir = join(dirname(normalizedTarget), '.locks');
    const targetKey = createHash('sha256').update(normalizedTarget).digest('hex');
    ensurePrivateDir(dirname(normalizedTarget));
    ensurePrivateDir(lockDir);
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
        ? Math.max(0, options.timeoutMs)
        : LOCK_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const token = randomUUID();
    const claimPath = join(lockDir, `${targetKey}.${token}.json`);
    const baseClaim = { token, pid: process.pid, createdAt: Date.now() };
    // Lamport's bakery algorithm avoids a shared lock filename entirely. Every
    // contender owns a generation-unique claim, so dead-owner cleanup cannot
    // delete a newer owner's lock (the stale-breaker ABA/TOCTOU failure mode).
    writeJsonFileAtomic(claimPath, { ...baseClaim, choosing: true, ticket: null });
    const initial = liveClaims(lockDir, targetKey, token);
    const ticket = initial.claims.reduce((max, claim) => Math.max(max, claim.ticket ?? 0), 0) + 1;
    writeJsonFileAtomic(claimPath, { ...baseClaim, choosing: false, ticket });
    try {
        while (true) {
            const { claims, invalid } = liveClaims(lockDir, targetKey, token);
            const blocked = invalid || claims.some((claim) => (claim.choosing
                || claim.ticket === null
                || claim.ticket < ticket
                || (claim.ticket === ticket && claim.token < token)));
            if (!blocked)
                break;
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for file lock: ${lockDir}`);
            }
            await delay(LOCK_RETRY_MS);
        }
        return action();
    }
    finally {
        try {
            unlinkSync(claimPath);
        }
        catch { /* best effort */ }
    }
}
