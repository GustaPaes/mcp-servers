import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage, StorageState } from './interfaces.js';
import { emptyState } from './interfaces.js';

export class FileStorage implements Storage {
  constructor(private readonly path: string) {}

  async read(): Promise<StorageState> {
    if (!existsSync(this.path)) return emptyState();
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as StorageState;
    } catch {
      return emptyState();
    }
  }

  async write(state: StorageState): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2), 'utf8');
  }
}
