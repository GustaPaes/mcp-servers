export class GrafanaError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export class GrafanaReadClient {
  constructor({ url, token, timeoutMs = 15000, fetchImpl = fetch }) {
    if (url) {
      const target = new URL(url);
      if (target.username || target.password || target.search || target.hash
        || !(target.protocol === 'https:' || (target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)))) {
        throw new GrafanaError('INVALID_GRAFANA_URL');
      }
      this.url = target.href.replace(/\/$/, '');
    }
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }
  async metadata(kind, uid, signal) {
    if (!this.url) throw new GrafanaError('GRAFANA_URL_REQUIRED');
    if (kind !== 'health' && !this.token) throw new GrafanaError('GRAFANA_TOKEN_REQUIRED');
    if (kind !== 'health' && (kind !== 'dashboard' || !/^[A-Za-z0-9_-]{1,80}$/.test(uid ?? ''))) throw new GrafanaError('ROUTE_NOT_ALLOWED');
    const route = kind === 'health' ? '/api/health' : `/api/dashboards/uid/${uid}`;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    let reader;
    try {
      const response = await this.fetchImpl(this.url + route, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(kind === 'health' ? {} : { Authorization: `Bearer ${this.token}` }) },
      });
      if (!response.ok) throw new GrafanaError(`GRAFANA_HTTP_${response.status}`);
      if (!response.body || Number(response.headers.get('content-length') ?? 0) > 2_000_000) throw new GrafanaError('RESPONSE_LIMIT');
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 2_000_000) throw new GrafanaError('RESPONSE_LIMIT');
        chunks.push(Buffer.from(chunk.value));
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new GrafanaError('INVALID_GRAFANA_RESPONSE'); }
    } catch (error) {
      if (error instanceof GrafanaError) throw error;
      throw new GrafanaError(controller.signal.aborted ? 'TIMEOUT_OR_CANCELLED' : 'GRAFANA_TRANSPORT_ERROR');
    } finally {
      await reader?.cancel().catch(() => {});
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}
