import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireSession();
  } catch {
    redirect('/login');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Meta Ads Control Room</strong>
          <span>MCP-first. No direct Graph API calls.</span>
        </div>
        <nav className="nav">
          <Link href="/accounts">Contas</Link>
          <Link href="/accounts">Selecionar conta</Link>
        </nav>
        <form className="logout" action="/api/auth/logout" method="post">
          <button type="submit">Sair</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
