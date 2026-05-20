import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE = 'meta_ads_panel_session';

function secret(): string {
  return process.env.WEB_PANEL_SESSION_SECRET ?? 'dev-secret-change-me';
}

function password(): string {
  return process.env.WEB_PANEL_PASSWORD ?? 'change-me';
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
  return safeEqual(signature, sign(payload));
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
