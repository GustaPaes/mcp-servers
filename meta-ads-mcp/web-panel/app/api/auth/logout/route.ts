import { NextResponse } from 'next/server';
import { sessionCookieName } from '../../../../lib/auth';

export async function POST(req: Request): Promise<NextResponse> {
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  res.cookies.delete(sessionCookieName());
  return res;
}
