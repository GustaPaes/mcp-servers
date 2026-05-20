import Link from 'next/link';
import { ErrorCard, ModeBadge, PageHeader } from '../../../components/ui';
import { listAccounts } from '../../../lib/mcp';

export default async function AccountsPage() {
  try {
    const accounts = await listAccounts();
    return (
      <>
        <PageHeader
          title="Contas de anúncio"
          description="Selecione uma conta para analisar campanhas, recomendações, drafts e auditoria. Tokens nunca são expostos ao browser."
        />
        <section className="grid cols-3">
          {accounts.map((account) => (
            <Link className="card" key={account.id} href={`/${encodeURIComponent(account.id)}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <h2>{account.name}</h2>
                <ModeBadge mode={account.effectiveMode} />
              </div>
              <p className="muted">{account.adAccountId} · {account.currency} · {account.country}</p>
              <p>{account.niche}</p>
              <div className="grid cols-2">
                <div className="kpi"><span>Objetivo</span><strong style={{ fontSize: 15 }}>{account.primaryObjective}</strong></div>
                <div className="kpi"><span>Token</span><strong style={{ fontSize: 15 }}>{account.hasToken ? 'OK' : 'Ausente'}</strong></div>
              </div>
            </Link>
          ))}
        </section>
      </>
    );
  } catch (error) {
    return <ErrorCard error={error} />;
  }
}
