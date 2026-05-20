import { AccountNav, ErrorCard, ModeBadge, PageHeader } from '../../../../components/ui';
import { SettingsForm } from '../../../../components/settings-form';
import { accountProfile } from '../../../../lib/mcp';

export default async function SettingsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const resolved = await params;
  const accountId = decodeURIComponent(resolved.accountId);
  try {
    const profile = await accountProfile(accountId);
    return (
      <>
        <PageHeader title="Configuração da conta" description="Configuração estratégica local. Credenciais e modo operacional exigem alteração de ambiente/deploy." actions={<ModeBadge mode={String(profile.effectiveMode ?? 'unknown')} />} />
        <AccountNav accountId={accountId} />
        <SettingsForm accountId={accountId} profile={profile} />
      </>
    );
  } catch (error) {
    return <ErrorCard error={error} />;
  }
}
