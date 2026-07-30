const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function requestIdentity(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip') || 'local';
}

export function requireSameOrigin(req: Request): void {
  const expected = new URL(req.url).origin;
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (origin && origin !== expected) throw new Error('Cross-origin request blocked');
  if (!origin && fetchSite === 'cross-site') throw new Error('Cross-site request blocked');
}

export function enforceLoginRateLimit(
  req: Request,
  { limit = 5, windowMs = 60_000 } = {},
): void {
  const now = Date.now();
  const identity = requestIdentity(req);
  const current = loginAttempts.get(identity);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(identity, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) throw new Error('Too many login attempts; try again later');
  current.count += 1;
}

export function clearLoginRateLimit(req: Request): void {
  loginAttempts.delete(requestIdentity(req));
}
