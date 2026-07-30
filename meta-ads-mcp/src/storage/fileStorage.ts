import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteJsonSync } from '@gustapaes/mcp-runtime';
import type { Storage, StorageState } from './interfaces.js';
import { emptyState } from './interfaces.js';

export class FileStorage implements Storage {
  constructor(private readonly path: string) {}

  async read(): Promise<StorageState> {
    if (!existsSync(this.path)) return emptyState();
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as StorageState;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Storage file is not valid JSON: ${message}`);
    }
  }

  async write(state: StorageState): Promise<void> {
    atomicWriteJsonSync(this.path, state);
  }
}
