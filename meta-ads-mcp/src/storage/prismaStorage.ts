/**
 * PrismaStorage — backend opcional baseado em Postgres via Prisma.
 *
 * Para usar:
 *   1) npm i @prisma/client
 *   2) npm i -D prisma
 *   3) Use o schema em prisma/schema.prisma (incluído neste projeto).
 *   4) npx prisma migrate dev --name init
 *   5) STORAGE_BACKEND=prisma DATABASE_URL=... no .env
 *
 * O import do @prisma/client é dinâmico para que o módulo continue compilando
 * mesmo quando o cliente não está instalado (storage padrão continua sendo file).
 */
import type {
  Storage,
  StorageState,
  StoredDraft,
} from './interfaces.js';
import { emptyState } from './interfaces.js';
import type { CampaignDraft } from '../schemas/campaign.schema.js';
import type { AdSetDraft } from '../schemas/adset.schema.js';
import type { AdCreativeDraft } from '../schemas/creative.schema.js';

// Tipo mínimo do PrismaClient que precisamos. Evita dependência de tipos.
interface DraftRow {
  id: string;
  accountId: string;
  kind: 'campaign' | 'adset' | 'creative';
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface PrismaClientLike {
  draft: {
    findMany(args?: unknown): Promise<DraftRow[]>;
    deleteMany(args?: unknown): Promise<unknown>;
    createMany(args: { data: Array<Omit<DraftRow, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }> }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: PrismaClientLike) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
}

export class PrismaStorage implements Storage {
  private clientPromise: Promise<PrismaClientLike> | undefined;

  private async client(): Promise<PrismaClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        // @prisma/client é dependência OPCIONAL — só existe quando o usuário
        // ativa STORAGE_BACKEND=prisma e instala manualmente.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - pacote opcional, instalado pelo usuário sob demanda
        const mod: unknown = await import('@prisma/client');
        const { PrismaClient } = mod as { PrismaClient: new () => PrismaClientLike };
        return new PrismaClient();
      })();
    }
    return this.clientPromise;
  }

  async read(): Promise<StorageState> {
    const db = await this.client();
    const rows = await db.draft.findMany();
    const state = emptyState();
    for (const row of rows) {
      const stored = {
        id: row.id,
        accountId: row.accountId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        data: row.data,
      };
      if (row.kind === 'campaign') {
        state.campaignDrafts.push(stored as StoredDraft<CampaignDraft>);
      } else if (row.kind === 'adset') {
        state.adSetDrafts.push(stored as StoredDraft<AdSetDraft>);
      } else if (row.kind === 'creative') {
        state.creativeDrafts.push(stored as StoredDraft<AdCreativeDraft>);
      }
    }
    return state;
  }

  async write(state: StorageState): Promise<void> {
    const db = await this.client();
    const now = new Date();
    const rows: Array<Omit<DraftRow, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }> = [];

    for (const d of state.campaignDrafts) {
      rows.push({
        id: d.id,
        accountId: d.accountId,
        kind: 'campaign',
        data: d.data as unknown,
        createdAt: new Date(d.createdAt),
        updatedAt: new Date(d.updatedAt ?? now.toISOString()),
      });
    }
    for (const d of state.adSetDrafts) {
      rows.push({
        id: d.id,
        accountId: d.accountId,
        kind: 'adset',
        data: d.data as unknown,
        createdAt: new Date(d.createdAt),
        updatedAt: new Date(d.updatedAt ?? now.toISOString()),
      });
    }
    for (const d of state.creativeDrafts) {
      rows.push({
        id: d.id,
        accountId: d.accountId,
        kind: 'creative',
        data: d.data as unknown,
        createdAt: new Date(d.createdAt),
        updatedAt: new Date(d.updatedAt ?? now.toISOString()),
      });
    }

    await db.$transaction(async (tx) => {
      await tx.draft.deleteMany({});
      if (rows.length > 0) {
        await tx.draft.createMany({ data: rows });
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.clientPromise) {
      const c = await this.clientPromise;
      await c.$disconnect();
    }
  }
}
