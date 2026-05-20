'use client';

import { useState, useTransition } from 'react';

export function SettingsForm({ accountId, profile }: { accountId: string; profile: Record<string, unknown> }) {
  const [result, setResult] = useState<unknown>();
  const [pending, startTransition] = useTransition();

  async function submit(formData: FormData) {
    const forbiddenWords = String(formData.get('forbiddenWords') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const tone = String(formData.get('tone') ?? '');
    const requestedBy = String(formData.get('requestedBy') ?? 'web-panel');
    const reason = String(formData.get('reason') ?? 'web-panel settings update');
    startTransition(async () => {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          patch: {
            ...(tone ? { tone } : {}),
            internalPolicies: {
              ...((profile.internalPolicies as Record<string, unknown> | undefined) ?? {}),
              forbiddenWords,
            },
          },
          requestedBy,
          reason,
        }),
      });
      setResult(await res.json());
    });
  }

  return (
    <section className="grid cols-2">
      <form className="card form" action={submit}>
        <h2>Atualizar perfil estratégico</h2>
        <div className="field"><label>Tom de comunicação</label><textarea name="tone" defaultValue={String(profile.tone ?? '')} /></div>
        <div className="field"><label>Forbidden words (CSV)</label><input name="forbiddenWords" defaultValue={((profile.internalPolicies as { forbiddenWords?: string[] } | undefined)?.forbiddenWords ?? []).join(', ')} /></div>
        <div className="field"><label>Requested by</label><input name="requestedBy" defaultValue="web-panel" required /></div>
        <div className="field"><label>Reason</label><input name="reason" defaultValue="web-panel settings update" required minLength={5} /></div>
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Salvando...' : 'Salvar localmente'}</button>
        <p className="muted">`tokenEnvVar`, `adAccountId` e modo da conta são deliberadamente read-only no painel.</p>
      </form>
      <div className="card"><h2>Resposta</h2><pre>{result ? JSON.stringify(result, null, 2) : JSON.stringify(profile, null, 2)}</pre></div>
    </section>
  );
}
