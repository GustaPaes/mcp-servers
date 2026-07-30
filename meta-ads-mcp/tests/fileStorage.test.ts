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
});
