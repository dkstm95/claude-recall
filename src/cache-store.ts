import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJsonFile, writeJsonFileAtomic } from './json-file.js';

const BASE_DIR = join(homedir(), '.claude', 'claude-recall');

export function claudeRecallPath(...parts: string[]): string {
  return join(BASE_DIR, ...parts);
}

export class JsonCache<T> {
  constructor(
    private readonly path: string,
    private readonly normalize: (value: unknown) => T,
  ) {}

  read(): T {
    return this.normalize(readJsonFile<unknown>(this.path));
  }

  write(data: T): void {
    try {
      writeJsonFileAtomic(this.path, data);
    } catch {
      // best-effort; cache miss on next read is harmless
    }
  }
}

export function objectOr<T extends object>(fallback: () => T): (value: unknown) => T {
  return (value: unknown): T => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as T;
    }
    return fallback();
  };
}
