import { linkAbortSignal } from './abort';
import { AgentQueryCrawlError, responseToError } from './errors';
import { DEFAULT_LIMITS } from './limits';
import { sanitizeUntrustedWebText, validateSafeHttpsUrl, type SafetyOptions } from './web-safety';
import type { FetchLike } from './exa-search';

export const WEB_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  Accept: 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  'Accept-Language': 'en-US,en;q=0.9',
};

export type WebFetchResult = {
  url: string;
  contentType: string;
  text: string;
};

export type WebFetchInput = {
  url: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WebFetchOptions = SafetyOptions & {
  fetch?: FetchLike;
  proxyBaseUrl?: string;
  maxResponseBytes?: number;
  maxTextCharacters?: number;
};

function pickFetch(customFetch?: FetchLike): FetchLike {
  if (typeof customFetch === 'function') return customFetch;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new AgentQueryCrawlError('network_unavailable', 'A fetch implementation is required.');
}

/** Create a safe web page fetcher with timeout, size limits, and HTML-to-text conversion. */
export function createWebFetch(options: WebFetchOptions = {}) {
  const fetch = pickFetch(options.fetch);

  return {
    async fetch(input: WebFetchInput): Promise<WebFetchResult> {
      const safeUrl = validateSafeHttpsUrl(input.url, 'webfetch', options);
      const requestUrl = options.proxyBaseUrl ? `${options.proxyBaseUrl}?url=${encodeURIComponent(safeUrl)}` : safeUrl;
      const linked = linkAbortSignal(input.signal);
      const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_LIMITS.webFetchTimeoutMs, DEFAULT_LIMITS.maxWebFetchTimeoutMs);
      const timeoutHandle = setTimeout(() => linked.controller.abort(), timeoutMs);

      try {
        const response = await fetch(requestUrl, {
          method: 'GET',
          signal: linked.signal,
          headers: WEB_FETCH_HEADERS,
        });

        if (!response.ok) throw await responseToError(response, 'Web fetch failed');

        const contentLength = response.headers.get('content-length');
        const maxBytes = options.maxResponseBytes ?? DEFAULT_LIMITS.maxWebResponseBytes;
        if (contentLength && Number(contentLength) > maxBytes) {
          throw new AgentQueryCrawlError('unsupported', `Response too large (exceeds ${maxBytes} byte limit).`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        const text = await readLimitedResponseText(response, maxBytes);

        return {
          url: safeUrl,
          contentType: contentType.split(';')[0]?.trim().toLowerCase() || '',
          text: sanitizeUntrustedWebText(
            contentType.toLowerCase().includes('text/html') ? htmlToText(text) : text,
            options.maxTextCharacters ?? DEFAULT_LIMITS.maxSourceTextCharacters,
          ),
        };
      } catch (error) {
        if (input.signal?.aborted) throw new AgentQueryCrawlError('abort', 'The web fetch request was aborted.', { cause: error });
        if (error instanceof AgentQueryCrawlError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw new AgentQueryCrawlError('timeout', 'Request timed out.', { cause: error });
        throw error;
      } finally {
        clearTimeout(timeoutHandle);
        linked.cleanup();
      }
    },
  };
}

/** Read a response body while enforcing a byte limit. */
export async function readLimitedResponseText(response: Response, maxBytes = DEFAULT_LIMITS.maxWebResponseBytes): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (text.length > maxBytes) throw new AgentQueryCrawlError('unsupported', `Response too large (exceeds ${maxBytes} byte limit).`);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  let canceled = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      received += value.byteLength;
      if (received > maxBytes) {
        canceled = true;
        await reader.cancel();
        throw new AgentQueryCrawlError('unsupported', `Response too large (exceeds ${maxBytes} byte limit).`);
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    if (!canceled) reader.releaseLock();
  }
}

/** Lightweight HTML-to-text conversion for crawled pages. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
