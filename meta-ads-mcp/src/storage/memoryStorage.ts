import type { Storage, StorageState } from './interfaces.js';
import { emptyState } from './interfaces.js';

export class MemoryStorage implements Storage {
  private state: StorageState = emptyState();
  async read(): Promise<StorageState> {
    return structuredClone(this.state);
  }
  async write(state: StorageState): Promise<void> {
    this.state = structuredClone(state);
  }
}
