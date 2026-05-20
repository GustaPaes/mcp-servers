import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE = 'meta_ads_panel_session';

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const publicPath = pathname.startsWith('/login') || pathname.startsWith('/api/auth') || pathname.startsWith('/_next');
  if (publicPath) return NextResponse.next();
  if (!req.cookies.get(COOKIE)?.value) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
