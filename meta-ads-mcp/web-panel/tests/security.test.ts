import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearLoginRateLimit,
  enforceLoginRateLimit,
  requireSameOrigin,
} from '../lib/request-security';

test('blocks cross-origin mutations', () => {
  const req = new Request('https://panel.example.test/api/settings', {
    method: 'POST',
    headers: { origin: 'https://attacker.example.test' },
  });
  assert.throws(() => requireSameOrigin(req), /Cross-origin/);
});

test('accepts same-origin mutations', () => {
  const req = new Request('https://panel.example.test/api/settings', {
    method: 'POST',
    headers: { origin: 'https://panel.example.test' },
  });
  assert.doesNotThrow(() => requireSameOrigin(req));
});

test('rate limits repeated login attempts', () => {
  const req = new Request('https://panel.example.test/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://panel.example.test',
      'x-real-ip': '192.0.2.10',
    },
  });
  clearLoginRateLimit(req);
  enforceLoginRateLimit(req, { limit: 2, windowMs: 60_000 });
  enforceLoginRateLimit(req, { limit: 2, windowMs: 60_000 });
  assert.throws(
    () => enforceLoginRateLimit(req, { limit: 2, windowMs: 60_000 }),
    /Too many login attempts/,
  );
  clearLoginRateLimit(req);
});
