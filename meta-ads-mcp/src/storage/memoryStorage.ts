import type { Storage, StorageState, StorageUpdate } from './interfaces.js';
import { emptyState, normalizeState } from './interfaces.js';
import { SerialQueue } from './serialQueue.js';

export class MemoryStorage implements Storage {
  private state: StorageState = emptyState();
  private readonly queue = new SerialQueue();

  async read(): Promise<StorageState> {
    return this.queue.run(async () => structuredClone(this.state));
  }

  async write(state: StorageState): Promise<void> {
    await this.queue.run(async () => {
      this.state = structuredClone(normalizeState(state));
    });
  }

  async update<T>(mutate: (state: StorageState) => T | Promise<T>): Promise<StorageUpdate<T>> {
    return this.queue.run(async () => {
      const next = structuredClone(this.state);
      const result = await mutate(next);
      next.revision += 1;
      this.state = next;
      return { result, revision: next.revision };
    });
  }
}
