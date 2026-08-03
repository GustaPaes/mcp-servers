import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteJsonSync } from '@gustapaes/mcp-runtime';
import type { Storage, StorageState, StorageUpdate } from './interfaces.js';
import { emptyState, normalizeState } from './interfaces.js';
import { SerialQueue } from './serialQueue.js';

export class FileStorage implements Storage {
  private readonly queue = new SerialQueue();

  constructor(private readonly path: string) {}

  async read(): Promise<StorageState> {
    return this.queue.run(async () => structuredClone(this.readCurrent()));
  }

  async write(state: StorageState): Promise<void> {
    await this.queue.run(async () => {
      atomicWriteJsonSync(this.path, normalizeState(state));
    });
  }

  async update<T>(mutate: (state: StorageState) => T | Promise<T>): Promise<StorageUpdate<T>> {
    return this.queue.run(async () => {
      const next = structuredClone(this.readCurrent());
      const result = await mutate(next);
      next.revision += 1;
      atomicWriteJsonSync(this.path, next);
      return { result, revision: next.revision };
    });
  }

  private readCurrent(): StorageState {
    if (!existsSync(this.path)) return emptyState();
    try {
      return normalizeState(JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StorageState>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Storage file is not valid JSON: ${message}`);
    }
  }
}
