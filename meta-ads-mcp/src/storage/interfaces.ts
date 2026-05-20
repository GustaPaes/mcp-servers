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
  campaignDrafts: StoredDraft<CampaignDraft>[];
  adSetDrafts: StoredDraft<AdSetDraft>[];
  creativeDrafts: StoredDraft<AdCreativeDraft>[];
}

export interface Storage {
  read(): Promise<StorageState>;
  write(state: StorageState): Promise<void>;
}

export function emptyState(): StorageState {
  return { campaignDrafts: [], adSetDrafts: [], creativeDrafts: [] };
}
