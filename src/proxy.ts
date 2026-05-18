import { EXA_MCP_URL } from './exa-search';
import { DEFAULT_LIMITS } from './limits';
import { readLimitedResponseText, WEB_FETCH_HEADERS, htmlToText } from './web-fetch';
import { sanitizeSearchQuery, sanitizeUntrustedWebText, validateSafeHttpsUrl, type SafetyOptions } from './web-safety';
import type { FetchLike } from './exa-search';

export type AgentQueryCrawlProxyOptions = SafetyOptions & {
  fetch?: FetchLike;
  exaEndpoint?: string;
  webFetchTimeoutMs?: number;
  maxWebResponseBytes?: number;
};

function pickFetch(customFetch?: FetchLike): FetchLike {
  if (typeof customFetch === 'function') return customFetch;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new Error('A fetch implementation is required.');
}

function noStoreText(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** Create framework-agnostic proxy handlers for Exa MCP and safe web fetches. */
export function createAgentQueryCrawlProxy(options: AgentQueryCrawlProxyOptions = {}) {
  const fetch = pickFetch(options.fetch);

  return {
    async exaMcp(request: Request): Promise<Response> {
      const body = await request.text();
      if (!isSafeExaRequest(body, options)) {
        return noStoreText('Missing or invalid query', 400);
      }

      const upstream = await fetch(options.exaEndpoint ?? EXA_MCP_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body,
      });

      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
          'Cache-Control': 'no-store',
        },
      });
    },

    async webFetch(request: Request): Promise<Response> {
      const url = new URL(request.url).searchParams.get('url') ?? '';
      let safeUrl: string;

      try {
        safeUrl = validateSafeHttpsUrl(url, 'webfetch proxy', options);
      } catch {
        return noStoreText('Missing or invalid url', 400);
      }

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), options.webFetchTimeoutMs ?? DEFAULT_LIMITS.webFetchTimeoutMs);
      let upstream: Response;

      try {
        upstream = await fetch(safeUrl, {
          method: 'GET',
          headers: WEB_FETCH_HEADERS,
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        return noStoreText(error instanceof Error && error.name === 'AbortError' ? 'Upstream request timed out' : 'Upstream request failed', error instanceof Error && error.name === 'AbortError' ? 504 : 502);
      } finally {
        clearTimeout(timeoutHandle);
      }

      let text: string;
      try {
        text = await readLimitedResponseText(upstream, options.maxWebResponseBytes ?? DEFAULT_LIMITS.maxWebResponseBytes);
      } catch {
        return noStoreText('Response too large', 413);
      }

      const contentType = upstream.headers.get('Content-Type') ?? '';
      const plainText = contentType.toLowerCase().includes('text/html') ? htmlToText(text) : text;

      return noStoreText(sanitizeUntrustedWebText(plainText), upstream.status);
    },
  };
}

/** Validate that an incoming Exa MCP proxy body is a web_search_exa request with a safe query. */
export function isSafeExaRequest(body: string, options: SafetyOptions = {}): boolean {
  try {
    const payload = JSON.parse(body) as {
      jsonrpc?: unknown;
      method?: unknown;
      params?: { name?: unknown; arguments?: { query?: unknown } };
    };

    if (payload.jsonrpc !== '2.0' || payload.method !== 'tools/call' || payload.params?.name !== 'web_search_exa') return false;
    if (typeof payload.params.arguments?.query !== 'string') return false;

    sanitizeSearchQuery(payload.params.arguments.query, options);
    return true;
  } catch {
    return false;
  }
}
