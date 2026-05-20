import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/utils/logger.js';

describe('redactSecrets', () => {
  it('redacts EAA tokens (with or without Bearer prefix)', () => {
    const s = redactSecrets('Bearer EAA_REDACTION_TEST_VALUE') as string;
    expect(s).toContain('[REDACTED]');
    expect(s).not.toContain('EAA_REDACTION_TEST_VALUE');
    const s2 = redactSecrets('EAA_REDACTION_TEST_VALUE') as string;
    expect(s2).toBe('[REDACTED]');
  });

  it('redacts json access_token', () => {
    const out = redactSecrets({ payload: { access_token: 'test-token-value', other: 'ok' } });
    expect(JSON.stringify(out)).not.toContain('test-token-value');
    expect(JSON.stringify(out)).toContain('[REDACTED]');
  });

  it('redacts keys named token, secret, password', () => {
    const out = redactSecrets({ token: 'x', api_key: 'y', password: 'z', name: 'ok' }) as Record<string, string>;
    expect(out.token).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.name).toBe('ok');
  });
});
