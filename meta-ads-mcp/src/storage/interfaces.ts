import type { CampaignDraft } from '../schemas/campaign.schema.js';
import type { AdSetDraft } from '../schemas/adset.schema.js';
import type { AdCreativeDraft } from '../schemas/creative.schema.js';

export interface StoredDraft<T> {
  id: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  data: T;
}

export interface StorageState {
  /** Monotonic revision used to detect and communicate storage changes. */
  revision: number;
  campaignDrafts: StoredDraft<CampaignDraft>[];
  adSetDrafts: StoredDraft<AdSetDraft>[];
  creativeDrafts: StoredDraft<AdCreativeDraft>[];
}

export interface StorageUpdate<T> {
  result: T;
  revision: number;
}

export interface Storage {
  read(): Promise<StorageState>;
  write(state: StorageState): Promise<void>;
  /**
   * Executes a read-modify-write cycle serially. Implementations must not
   * expose partially mutated state when the callback throws.
   */
  update<T>(mutate: (state: StorageState) => T | Promise<T>): Promise<StorageUpdate<T>>;
}

export function emptyState(): StorageState {
  return { revision: 0, campaignDrafts: [], adSetDrafts: [], creativeDrafts: [] };
}

export function normalizeState(state: Partial<StorageState>): StorageState {
  return {
    revision: Number.isSafeInteger(state.revision) && (state.revision ?? -1) >= 0
      ? state.revision!
      : 0,
    campaignDrafts: Array.isArray(state.campaignDrafts) ? state.campaignDrafts : [],
    adSetDrafts: Array.isArray(state.adSetDrafts) ? state.adSetDrafts : [],
    creativeDrafts: Array.isArray(state.creativeDrafts) ? state.creativeDrafts : [],
  };
}
