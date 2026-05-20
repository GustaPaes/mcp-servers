import Link from 'next/link';

export function ModeBadge({ mode }: { mode?: string }) {
  const cls = mode === 'write-enabled' ? 'red' : mode === 'dry-run' ? 'yellow' : 'green';
  return <span className={`badge ${cls}`}>{mode ?? 'unknown'}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <header className="hero">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions}
    </header>
  );
}

export function AccountNav({ accountId }: { accountId: string }) {
  const base = `/${encodeURIComponent(accountId)}`;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <nav className="nav" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Link href={base}>Dashboard</Link>
        <Link href={`${base}/campaigns`}>Campanhas</Link>
        <Link href={`${base}/recommendations`}>Recomendações</Link>
        <Link href={`${base}/creatives/analyze`}>Criativo</Link>
        <Link href={`${base}/settings`}>Configuração</Link>
        <Link href={`${base}/audit`}>Auditoria</Link>
      </nav>
    </div>
  );
}

export function ErrorCard({ error }: { error: unknown }) {
  return (
    <section className="card">
      <h2>Não foi possível carregar</h2>
      <p className="error">{error instanceof Error ? error.message : String(error)}</p>
      <p className="muted">Confirme que o MCP está rodando com `MCP_TRANSPORT=http` e que `META_ADS_MCP_HTTP_URL` aponta para `/mcp`.</p>
    </section>
  );
}
