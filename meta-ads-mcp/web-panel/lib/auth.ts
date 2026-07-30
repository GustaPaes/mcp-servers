import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE = 'meta_ads_panel_session';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.WEB_PANEL_SESSION_SECRET ?? 'dev-secret-change-me';
  if (process.env.NODE_ENV === 'production' && value.length < 32) {
    throw new Error('WEB_PANEL_SESSION_SECRET must contain at least 32 characters in production');
  }
  return value;
}

function password(): string {
  const value = process.env.WEB_PANEL_PASSWORD ?? 'change-me';
  if (process.env.NODE_ENV === 'production' && value === 'change-me') {
    throw new Error('WEB_PANEL_PASSWORD must be configured in production');
  }
  return value;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyPassword(input: string): boolean {
  return safeEqual(sign(input), sign(password()));
}

export function createSessionValue(): string {
  const payload = `operator:${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function isValidSession(value?: string): boolean {
  if (!value) return false;
  const idx = value.lastIndexOf('.');
  if (idx <= 0) return false;
  const payload = value.slice(0, idx);
  const signature = value.slice(idx + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  const match = /^operator:(\d+)$/.exec(payload);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now()) return false;
  return Date.now() - issuedAt <= SESSION_MAX_AGE_MS;
}

export async function requireSession(): Promise<void> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!isValidSession(value)) {
    throw new Error('Unauthenticated');
  }
}

export function sessionCookieName(): string {
  return COOKIE;
}
