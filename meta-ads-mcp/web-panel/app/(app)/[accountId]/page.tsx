import { AccountNav, ErrorCard, ModeBadge, PageHeader } from '../../../components/ui';
import { accountProfile, performanceReport, wastedSpend } from '../../../lib/mcp';
import { currency, number, pct, shortJson } from '../../../lib/format';

export default async function DashboardPage({ params }: { params: Promise<{ accountId: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  try {
    const [profile, report, waste] = await Promise.all([
      accountProfile(accountId),
      performanceReport(accountId),
      wastedSpend(accountId),
    ]);
    const totals = (report.totals ?? {}) as Record<string, number | string | undefined>;
    return (
      <>
        <PageHeader
          title={`${String(profile.name ?? accountId)}`}
          description="Dashboard executivo: KPIs de 30 dias, desperdício potencial e postura de segurança da conta."
          actions={<ModeBadge mode={String(profile.effectiveMode ?? 'unknown')} />}
        />
        <AccountNav accountId={accountId} />
        <section className="grid cols-4">
          <div className="card kpi"><span>Spend</span><strong>{currency(totals.spend, String(profile.currency ?? 'BRL'))}</strong></div>
          <div className="card kpi"><span>Impressões</span><strong>{number(totals.impressions)}</strong></div>
          <div className="card kpi"><span>CTR</span><strong>{pct(totals.ctrPct)}</strong></div>
          <div className="card kpi"><span>ROAS</span><strong>{number(totals.roas)}</strong></div>
          <div className="card kpi"><span>Cliques</span><strong>{number(totals.clicks)}</strong></div>
          <div className="card kpi"><span>Conversões</span><strong>{number(totals.conversions)}</strong></div>
          <div className="card kpi"><span>CPC</span><strong>{currency(totals.cpc, String(profile.currency ?? 'BRL'))}</strong></div>
          <div className="card kpi"><span>CPA</span><strong>{currency(totals.cpa, String(profile.currency ?? 'BRL'))}</strong></div>
        </section>
        <section className="grid cols-2" style={{ marginTop: 16 }}>
          <div className="card">
            <h2>Alertas de desperdício</h2>
            <pre>{shortJson(waste)}</pre>
          </div>
          <div className="card">
            <h2>Perfil estratégico</h2>
            <pre>{shortJson(profile)}</pre>
          </div>
        </section>
      </>
    );
  } catch (error) {
    return <ErrorCard error={error} />;
  }
}
