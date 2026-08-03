import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountsFileSchema, type AccountConfig } from '../schemas/account.schema.js';
import { getEnv } from './env.js';

/**
 * Loads, validates and indexes the multi-account configuration.
 *
 * Security guarantees:
 *   - Tokens are NEVER read from the JSON file. The file only contains the
 *     name of the env var (`tokenEnvVar`) where the token must live.
 *   - If the env var is missing for an account, `getToken()` throws and the
 *     account can still be listed, but cannot be used for API calls.
 */
export class AccountRegistry {
  private readonly byId = new Map<string, AccountConfig>();

  constructor(accounts: AccountConfig[]) {
    for (const acc of accounts) {
      if (this.byId.has(acc.id)) {
        throw new Error(`Duplicate account id in configuration: ${acc.id}`);
      }
      this.byId.set(acc.id, acc);
    }
  }

  static fromFile(path?: string): AccountRegistry {
    const env = getEnv();
    const filePath = resolve(path ?? env.ACCOUNTS_CONFIG_PATH);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(
        'Cannot read accounts config. Verify ACCOUNTS_CONFIG_PATH and copy ' +
          'config/accounts.example.json to the configured location.',
        { cause: err },
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new Error('Invalid JSON in accounts config.', { cause: err });
    }
    const parsed = AccountsFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid accounts configuration: ${issues}`);
    }
    return new AccountRegistry(parsed.data.accounts);
  }

  list(): AccountConfig[] {
    return [...this.byId.values()];
  }

  get(id: string): AccountConfig {
    const acc = this.byId.get(id);
    if (!acc) throw new Error(`Unknown account id: ${id}`);
    return acc;
  }

  /**
   * Reads the access token from the env var declared by the account, without
   * ever logging the value. Throws if missing or empty.
   */
  getToken(id: string): string {
    const acc = this.get(id);
    const token = process.env[acc.tokenEnvVar];
    if (!token || token.trim().length === 0) {
      throw new Error(
        `Missing access token for account "${id}". Set env var ${acc.tokenEnvVar} (never commit it).`,
      );
    }
    return token;
  }

  /** Replaces an account in-memory. Persistence is handled by the storage layer. */
  upsert(account: AccountConfig): void {
    this.byId.set(account.id, account);
  }
}
