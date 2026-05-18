/**
 * Error class used for query, crawl, and safety failures.
 *
 * All errors from this package use this class with a specific error code
 * to enable programmatic error handling by callers.
 */
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

/**
 * Convert failed HTTP responses into package errors.
 *
 * Attempts to read the response body for a more descriptive error message,
 * falling back to the provided message if reading fails or the body is empty.
 * The message is truncated to 500 characters to prevent large error payloads.
 */
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
