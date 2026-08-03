import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../src/storage/fileStorage.js';
import { emptyState } from '../src/storage/interfaces.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('FileStorage', () => {
  it('writes a complete JSON document atomically', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'meta-storage-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'storage.json');
    const storage = new FileStorage(file);
    await storage.write(emptyState());
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(emptyState());
  });

  it('fails closed when the storage file is corrupted', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'meta-storage-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'storage.json');
    await writeFile(file, '{not-json', 'utf8');
    const storage = new FileStorage(file);
    await expect(storage.read()).rejects.toThrow(/not valid JSON/);
  });

  it('serializes concurrent read-modify-write operations without losing drafts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'meta-storage-'));
    temporaryDirectories.push(directory);
    const storage = new FileStorage(path.join(directory, 'storage.json'));

    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        storage.update(async (state) => {
          await Promise.resolve();
          state.campaignDrafts.push({
            id: `draft-${index}`,
            accountId: 'example',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            data: {
              accountId: 'example',
              name: `Draft ${index}`,
              objective: 'OUTCOME_TRAFFIC',
              dailyBudget: 10,
              specialAdCategories: ['NONE'],
            },
          });
        }),
      ),
    );

    const state = await storage.read();
    expect(state.campaignDrafts).toHaveLength(50);
    expect(new Set(state.campaignDrafts.map((draft) => draft.id)).size).toBe(50);
    expect(state.revision).toBe(50);
  });
});
