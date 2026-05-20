import { AccountNav, ErrorCard, PageHeader } from '../../../../../components/ui';
import { accountAudit, campaignInsights, callTool } from '../../../../../lib/mcp';
import { currency, number, pct, shortJson } from '../../../../../lib/format';

export default async function CampaignDetailPage({ params }: { params: Promise<{ accountId: string; id: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  const campaignId = decodeURIComponent(resolved.id);
  try {
    const [rows, audit, recs] = await Promise.all([
      campaignInsights(accountId, campaignId),
      accountAudit(accountId),
      callTool('recommend_campaign_optimizations', {
        accountId,
        campaignId,
        metrics: { objectId: campaignId },
        goals: {},
      }),
    ]);
    const first = rows[0] ?? {};
    return (
      <>
        <PageHeader title="Detalhe da campanha" description={`Campanha ${campaignId}: métricas, recomendações, histórico e riscos.`} />
        <AccountNav accountId={accountId} />
        <section className="grid cols-4">
          <div className="card kpi"><span>Spend</span><strong>{currency(first.spend)}</strong></div>
          <div className="card kpi"><span>Impressões</span><strong>{number(first.impressions)}</strong></div>
          <div className="card kpi"><span>CTR</span><strong>{pct(first.ctr)}</strong></div>
          <div className="card kpi"><span>Frequência</span><strong>{number(first.frequency)}</strong></div>
        </section>
        <section className="grid cols-2" style={{ marginTop: 16 }}>
          <div className="card"><h2>Recomendações</h2><pre>{shortJson(recs)}</pre></div>
          <div className="card"><h2>Histórico recente</h2><pre>{shortJson(audit.slice(0, 8))}</pre></div>
        </section>
      </>
    );
  } catch (error) {
    return <ErrorCard error={error} />;
  }
}
