import { AccountNav, ErrorCard, PageHeader } from '../../../../components/ui';
import { accountAudit } from '../../../../lib/mcp';
import { shortJson } from '../../../../lib/format';

export default async function AuditPage({ params }: { params: Promise<{ accountId: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  try {
    const rows = await accountAudit(accountId);
    return (
      <>
        <PageHeader title="Auditoria" description="JSONL append-only, lido via MCP Resource e redigido antes de chegar ao painel." />
        <AccountNav accountId={accountId} />
        <section className="card table-wrap">
          <table>
            <thead><tr><th>Timestamp</th><th>Ação</th><th>Tool</th><th>Requested by</th><th>Resumo</th></tr></thead>
            <tbody>
              {rows.map((entry, idx) => (
                <tr key={`${entry.ts}-${idx}`}>
                  <td>{entry.ts}</td>
                  <td><span className="badge">{entry.action}</span></td>
                  <td>{entry.tool ?? '-'}</td>
                  <td>{entry.requestedBy ?? '-'}</td>
                  <td><pre>{shortJson({ reason: entry.reason, error: entry.error, meta: entry.meta, before: entry.before, after: entry.after })}</pre></td>
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
