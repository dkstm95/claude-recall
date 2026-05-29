import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    renameSync(tmp, path);
}
