import { NextResponse } from 'next/server';
import { sessionCookieName } from '../../../../lib/auth';
import { requireSameOrigin } from '../../../../lib/request-security';

export async function POST(req: Request): Promise<NextResponse> {
  requireSameOrigin(req);
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  res.cookies.delete(sessionCookieName());
  return res;
}
