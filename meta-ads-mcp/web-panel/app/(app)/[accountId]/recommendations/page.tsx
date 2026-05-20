import { AccountNav, ErrorCard, PageHeader } from '../../../../components/ui';
import { campaigns, callTool } from '../../../../lib/mcp';
import { shortJson } from '../../../../lib/format';

export default async function RecommendationsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  try {
    const rows = (await campaigns(accountId)).slice(0, 6);
    const recs = await Promise.all(
      rows.map((c) =>
        callTool('recommend_campaign_optimizations', {
          accountId,
          campaignId: c.id,
          metrics: { objectId: c.id },
          goals: {},
        }),
      ),
    );
    return (
      <>
        <PageHeader title="Central de recomendações" description="Recomendações são heurísticas e read-only. Aplicar mudanças exige confirmação no MCP." />
        <AccountNav accountId={accountId} />
        <section className="grid cols-2">
          {rows.map((campaign, idx) => (
            <div className="card" key={campaign.id}>
              <h2>{campaign.name}</h2>
              <p className="muted">{campaign.id}</p>
              <pre>{shortJson(recs[idx])}</pre>
              <p className="muted">Use o MCP para dry-run/aplicação com `confirm`, `reason`, `requestedBy` e `dryRun:false`.</p>
            </div>
          ))}
        </section>
      </>
    );
  } catch (error) {
    return <ErrorCard error={error} />;
  }
}
