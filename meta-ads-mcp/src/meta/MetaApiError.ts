export interface MetaApiErrorPayload {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  is_transient?: boolean;
}

export class MetaApiError extends Error {
  readonly httpStatus: number;
  readonly payload: MetaApiErrorPayload;
  readonly endpoint: string;

  constructor(opts: { httpStatus: number; payload: MetaApiErrorPayload; endpoint: string }) {
    super(`Meta API ${opts.httpStatus} at ${opts.endpoint}: ${opts.payload.message}`);
    this.name = 'MetaApiError';
    this.httpStatus = opts.httpStatus;
    this.payload = opts.payload;
    this.endpoint = opts.endpoint;
  }

  /**
   * Meta-specific error codes that are retriable (rate limit, transient,
   * temporarily unavailable). See:
   *   https://developers.facebook.com/docs/marketing-api/error-reference/
   */
  isRetriable(): boolean {
    if (this.payload.is_transient) return true;
    if (this.httpStatus >= 500 && this.httpStatus < 600) return true;
    const code = this.payload.code;
    // 1 = unknown error, 2 = service temporarily unavailable, 4 = rate limit,
    // 17 = user rate limit, 32 = page-level rate limit, 613 = call limit
    if (code != null && [1, 2, 4, 17, 32, 613].includes(code)) return true;
    if (this.httpStatus === 429) return true;
    return false;
  }
}
