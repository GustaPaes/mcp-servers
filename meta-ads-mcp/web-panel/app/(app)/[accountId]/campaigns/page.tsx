import Link from 'next/link';
import { AccountNav, ErrorCard, PageHeader } from '../../../../components/ui';
import { campaigns } from '../../../../lib/mcp';

export default async function CampaignsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  try {
    const rows = await campaigns(accountId);
    return (
      <>
        <PageHeader title="Campanhas" description="Lista de campanhas carregada via MCP. Nenhuma mutação é executada nesta tela." />
        <AccountNav accountId={accountId} />
        <section className="card table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Status</th><th>Objetivo</th><th>Orçamento</th><th>Atualizada</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(c.id)}`}>{c.name}</Link></td>
                  <td><span className="badge">{c.effective_status ?? c.status}</span></td>
                  <td>{c.objective ?? '-'}</td>
                  <td>{c.daily_budget ?? c.lifetime_budget ?? '-'}</td>
                  <td>{c.updated_time ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    );
  } catch (error) {
    return <ErrorCard error={error} />;
  }
}
