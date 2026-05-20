import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth';
import { listAccounts } from '../../../lib/mcp';

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
    return NextResponse.json({ ok: true, accounts: await listAccounts() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
