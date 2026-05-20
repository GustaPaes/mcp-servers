export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <main className="login">
      <section className="card">
        <div className="brand">
          <strong>Meta Ads Control Room</strong>
          <span>Painel administrativo seguro para o meta-ads-mcp.</span>
        </div>
        {params.error ? <p className="error">Senha inválida.</p> : null}
        <form className="form" action="/api/auth/login" method="post">
          <div className="field">
            <label htmlFor="password">Senha do painel</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="primary" type="submit">Entrar</button>
        </form>
        <p className="muted">Configure `WEB_PANEL_PASSWORD` e mantenha o MCP em `READ_ONLY=true` por padrão.</p>
      </section>
    </main>
  );
}
