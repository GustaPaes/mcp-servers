import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/auth';
import { callTool } from '../../../../../lib/mcp';

export async function POST(req: Request, ctx: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    await requireSession();
    const params = await ctx.params;
    const body = await req.json() as { patch?: Record<string, unknown>; reason?: string; requestedBy?: string };
    const result = await callTool('update_account_profile', {
      accountId: params.accountId,
      patch: body.patch ?? {},
      reason: body.reason ?? 'web-panel settings update',
      requestedBy: body.requestedBy ?? 'web-panel',
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
