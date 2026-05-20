import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/auth';
import { accountAudit } from '../../../../../lib/mcp';

export async function GET(_req: Request, ctx: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    await requireSession();
    const params = await ctx.params;
    return NextResponse.json({ ok: true, entries: await accountAudit(params.accountId) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
