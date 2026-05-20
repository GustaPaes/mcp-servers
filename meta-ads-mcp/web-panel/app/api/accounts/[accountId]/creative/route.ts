import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '../../../../../lib/auth';
import { callTool } from '../../../../../lib/mcp';

const Input = z.object({
  headline: z.string().min(2),
  primaryText: z.string().min(2),
  description: z.string().optional(),
  cta: z.string().min(2),
  productOrOffer: z.string().min(2),
  landingPageUrl: z.string().url().optional().or(z.literal('')),
  imageDescription: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    await requireSession();
    const params = await ctx.params;
    const json = Input.parse(await req.json());
    const args = { ...json, accountId: params.accountId, landingPageUrl: json.landingPageUrl || undefined };
    const [creative, audience] = await Promise.all([
      callTool('analyze_ad_creative', args),
      callTool('predict_best_audience_for_ad', args),
    ]);
    return NextResponse.json({ ok: true, creative, audience });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
