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

const ERROR_MESSAGE_LIMIT = 500;

async function readLimitedText(response: Response, limit: number): Promise<string> {
  // Read incrementally to avoid buffering large upstream error bodies in memory.
  // Cancels the stream reader in finally to release resources even when truncated.
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  try {
    while (bytesRead < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value.slice(0, limit - bytesRead), { stream: true });
      text += chunk;
      bytesRead += value.byteLength;
    }
    return text;
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function responseToError(response: Response, fallback = 'Upstream request failed.'): Promise<AgentQueryCrawlError> {
  let message = fallback;
  try {
    const text = await readLimitedText(response, ERROR_MESSAGE_LIMIT);
    if (text.trim()) {
      message = text.trim();
    }
  } catch {
  }

  return new AgentQueryCrawlError('upstream_failed', `${message} (${response.status}).`);
}