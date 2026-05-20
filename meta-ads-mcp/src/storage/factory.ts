/**
 * Storage factory — escolhe o backend correto baseado em STORAGE_BACKEND.
 *
 * Mantém PrismaStorage atrás de import dinâmico para que o pacote @prisma/client
 * seja realmente opcional (instalado só quando STORAGE_BACKEND=prisma).
 */
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import type { Storage } from './interfaces.js';
import { FileStorage } from './fileStorage.js';
import { MemoryStorage } from './memoryStorage.js';

export async function createStorage(): Promise<Storage> {
  const env = getEnv();
  const log = getLogger();

  switch (env.STORAGE_BACKEND) {
    case 'memory':
      log.info('storage.backend=memory (não-persistente; só para testes/dev)');
      return new MemoryStorage();

    case 'prisma': {
      if (!env.DATABASE_URL) {
        throw new Error(
          'STORAGE_BACKEND=prisma exige DATABASE_URL definido no ambiente.',
        );
      }
      try {
        const mod = await import('./prismaStorage.js');
        log.info('storage.backend=prisma');
        return new mod.PrismaStorage();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Falha ao carregar PrismaStorage (instale @prisma/client e rode prisma generate): ${message}`,
        );
      }
    }

    case 'file':
    default:
      log.info({ path: env.STORAGE_PATH }, 'storage.backend=file');
      return new FileStorage(env.STORAGE_PATH);
  }
}
