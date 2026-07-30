import { NextResponse } from 'next/server';
import { createSessionValue, sessionCookieName, verifyPassword } from '../../../../lib/auth';
import {
  clearLoginRateLimit,
  enforceLoginRateLimit,
  requireSameOrigin,
} from '../../../../lib/request-security';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    requireSameOrigin(req);
    enforceLoginRateLimit(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'request_blocked' }, { status: 429 });
  }
  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  if (!verifyPassword(password)) {
    return NextResponse.redirect(new URL('/login?error=invalid', req.url), { status: 303 });
  }
  clearLoginRateLimit(req);
  const res = NextResponse.redirect(new URL('/accounts', req.url), { status: 303 });
  res.cookies.set(sessionCookieName(), createSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
