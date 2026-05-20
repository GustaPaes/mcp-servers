import { AccountNav, PageHeader } from '../../../../../components/ui';
import { CreativeAnalyzer } from '../../../../../components/creative-analyzer';

export default async function CreativeAnalyzePage({ params }: { params: Promise<{ accountId: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  return (
    <>
      <PageHeader title="Análise de criativo" description="Avalie copy, CTA, oferta, imagem e audiência provável usando as engines do MCP." />
      <AccountNav accountId={accountId} />
      <CreativeAnalyzer accountId={accountId} />
    </>
  );
}
