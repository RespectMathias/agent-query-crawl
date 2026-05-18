/** Error class used for query, crawl, and safety failures. */
export class AgentQueryCrawlError extends Error {
  readonly code: 'unsupported' | 'timeout' | 'network_unavailable' | 'upstream_failed' | 'abort';

  constructor(
    code: AgentQueryCrawlError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentQueryCrawlError';
    this.code = code;
  }
}

/** Convert failed HTTP responses into package errors. */
export async function responseToError(response: Response, fallback = 'Upstream request failed.'): Promise<AgentQueryCrawlError> {
  let message = fallback;
  try {
    const text = await response.clone().text();
    if (text.trim()) {
      message = text.trim().slice(0, 500);
    }
  } catch {
  }

  return new AgentQueryCrawlError('upstream_failed', `${message} (${response.status}).`);
}
