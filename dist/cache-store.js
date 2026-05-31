import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJsonFile, writeJsonFileAtomic } from './json-file.js';
const BASE_DIR = join(homedir(), '.claude', 'claude-recall');
export function claudeRecallPath(...parts) {
    return join(BASE_DIR, ...parts);
}
export class JsonCache {
    path;
    normalize;
    constructor(path, normalize) {
        this.path = path;
        this.normalize = normalize;
    }
    read() {
        return this.normalize(readJsonFile(this.path));
    }
    write(data) {
        try {
            writeJsonFileAtomic(this.path, data);
        }
        catch {
            // best-effort; cache miss on next read is harmless
        }
    }
}
export function objectOr(fallback) {
    return (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        return fallback();
    };
}
