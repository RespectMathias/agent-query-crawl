import { linkAbortSignal } from './abort';
import { AgentQueryCrawlError, responseToError } from './errors';
import { DEFAULT_LIMITS } from './limits';
import { sanitizeSearchQuery, sanitizeUntrustedWebText, validateSafeHttpsUrl, type SafetyOptions } from './web-safety';

export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

export type FetchLike = typeof globalThis.fetch;

export type ExaSearchInput = {
  query: string;
  numResults?: number;
  livecrawl?: 'fallback' | 'preferred';
  type?: 'auto' | 'fast' | 'deep';
  contextMaxCharacters?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ExaSearchOptions = SafetyOptions & {
  fetch?: FetchLike;
  endpoint?: string;
  proxyBaseUrl?: string;
};

/**
 * Resolve the fetch implementation, preferring a custom one over the global.
 *
 * We bind globalThis.fetch to preserve the correct `this` context.
 */
function pickFetch(customFetch?: FetchLike): FetchLike {
  if (typeof customFetch === 'function') return customFetch;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new AgentQueryCrawlError('network_unavailable', 'A fetch implementation is required.');
}

/**
 * Create an Exa MCP search client.
 *
 * Communicates with the Exa MCP server to perform web searches. The client
 * sends a JSON-RPC request and parses Server-Sent Events from the response.
 * Supports optional proxying via proxyBaseUrl for environments that cannot
 * directly reach the Exa MCP endpoint.
 */
export function createExaSearch(options: ExaSearchOptions = {}) {
  const fetch = pickFetch(options.fetch);
  const endpoint = options.proxyBaseUrl ?? options.endpoint ?? EXA_MCP_URL;

  return {
    async search(input: ExaSearchInput): Promise<string> {
      const query = sanitizeSearchQuery(input.query, options);
      const linked = linkAbortSignal(input.signal);
      const timeoutHandle = setTimeout(() => linked.controller.abort(), input.timeoutMs ?? DEFAULT_LIMITS.exaSearchTimeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          signal: linked.signal,
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildExaMcpRequest({
            query,
            type: input.type,
            numResults: input.numResults,
            livecrawl: input.livecrawl,
            contextMaxCharacters: input.contextMaxCharacters,
          })),
        });

        if (!response.ok) throw await responseToError(response, 'Exa web search failed');

        return sanitizeUntrustedWebText(
          parseExaSse(await response.text()) ?? 'No search results found. Please try a different query.',
          DEFAULT_LIMITS.maxSearchTextCharacters,
        );
      } catch (error) {
        if (input.signal?.aborted) throw new AgentQueryCrawlError('abort', 'The Exa web search request was aborted.', { cause: error });
        if (error instanceof AgentQueryCrawlError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new AgentQueryCrawlError('timeout', 'The Exa web search request timed out.', { cause: error });
        }
        throw new AgentQueryCrawlError('network_unavailable', error instanceof Error ? error.message : 'Exa web search failed.', { cause: error });
      } finally {
        clearTimeout(timeoutHandle);
        linked.cleanup();
      }
    },
  };
}

/** Build the JSON-RPC MCP request body sent to Exa. */
export function buildExaMcpRequest(input: Omit<ExaSearchInput, 'signal' | 'timeoutMs'>) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'web_search_exa',
      arguments: {
        query: input.query,
        type: input.type ?? 'auto',
        numResults: input.numResults ?? DEFAULT_LIMITS.defaultSearchResults,
        livecrawl: input.livecrawl ?? 'fallback',
        ...(input.contextMaxCharacters ? { contextMaxCharacters: input.contextMaxCharacters } : {}),
      },
    },
  };
}

/**
 * Parse Exa MCP Server-Sent Events and return the first text content payload.
 *
 * Exa MCP responses are newline-delimited SSE where each line starts with
 * "data: ". The payload is a JSON-RPC response containing a result object
 * with a content array. We extract the first item with type "text".
 */
export function parseExaSse(body: string): string | undefined {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;

    try {
      const data = JSON.parse(line.substring(6)) as { result?: { content?: { type?: string; text?: string }[] } };
      const text = data.result?.content?.find((item) => item.type === 'text' && typeof item.text === 'string')?.text;
      if (text) return text;
    } catch {
    }
  }

  return undefined;
}

/**
 * Extract unique, safe HTTPS URLs from search or page text.
 *
 * Uses a regex to find HTTP/HTTPS URLs, strips trailing punctuation, then
 * validates each URL against safety rules (HTTPS only, no private IPs, etc.).
 * Returns deduplicated URLs in the order they appear in the text.
 */
export function extractUrlsFromText(text: string, options: SafetyOptions = {}): string[] {
  if (!text) return [];

  const seen = new Set<string>();
  const urls: string[] = [];
  const matches = text.match(/https?:\/\/[^\s)\]}>"']+/g) ?? [];

  for (const match of matches) {
    const url = match.replace(/[.,;:!?]+$/, '');
    let normalized: string;
    try {
      normalized = validateSafeHttpsUrl(url, 'exa result', options);
    } catch {
      continue;
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}
