'use client';

import { useState, useTransition } from 'react';

export function CreativeAnalyzer({ accountId }: { accountId: string }) {
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  async function submit(formData: FormData) {
    setError(undefined);
    const payload = Object.fromEntries(formData.entries());
    startTransition(async () => {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/creative`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as unknown;
      if (!res.ok) setError(JSON.stringify(json));
      setResult(json);
    });
  }

  return (
    <section className="grid cols-2">
      <form className="card form" action={submit}>
        <h2>Briefing do criativo</h2>
        <div className="field"><label>Headline</label><input name="headline" required minLength={2} maxLength={120} /></div>
        <div className="field"><label>Primary text</label><textarea name="primaryText" required minLength={2} maxLength={2000} /></div>
        <div className="field"><label>Descrição</label><input name="description" maxLength={300} /></div>
        <div className="field"><label>CTA</label><select name="cta" defaultValue="LEARN_MORE"><option>LEARN_MORE</option><option>SHOP_NOW</option><option>SIGN_UP</option><option>CONTACT_US</option><option>GET_OFFER</option></select></div>
        <div className="field"><label>Produto / oferta</label><input name="productOrOffer" required minLength={2} /></div>
        <div className="field"><label>Landing page URL</label><input name="landingPageUrl" type="url" /></div>
        <div className="field"><label>Descrição da imagem/vídeo</label><textarea name="imageDescription" maxLength={2000} /></div>
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Analisando...' : 'Analisar'}</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <div className="card">
        <h2>Resultado</h2>
        <pre>{result ? JSON.stringify(result, null, 2) : 'Preencha o briefing e envie para executar analyze_ad_creative + predict_best_audience_for_ad via MCP.'}</pre>
      </div>
    </section>
  );
}
