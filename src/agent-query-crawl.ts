import { createExaSearch, extractUrlsFromText, type ExaSearchInput, type ExaSearchOptions, type FetchLike } from './exa-search';
import { DEFAULT_LIMITS } from './limits';
import { createWebFetch, type WebFetchOptions, type WebFetchResult } from './web-fetch';
import { sanitizeSearchQuery, type SafetyOptions } from './web-safety';

export type AgentQueryCrawlInput = {
  query: string;
  /** Number of search results requested from Exa and default number of pages to crawl. */
  limit?: number;
  search?: Omit<ExaSearchInput, 'query' | 'signal' | 'numResults'> & { numResults?: number };
  crawl?: {
    enabled?: boolean;
    maxPages?: number;
    timeoutMs?: number;
  };
  signal?: AbortSignal;
};

export type AgentQueryCrawlResult = {
  query: string;
  resultsText: string;
  urls: string[];
  sources: WebFetchResult[];
};

export type AgentQueryCrawlOptions = SafetyOptions & {
  fetch?: FetchLike;
  search?: ExaSearchOptions;
  webFetch?: WebFetchOptions;
};

/** Create an agent-oriented internet query and crawl client. */
export function createAgentQueryCrawl(options: AgentQueryCrawlOptions = {}) {
  const search = createExaSearch({ fetch: options.fetch, ...options.search, logger: options.logger });
  const webFetch = createWebFetch({ fetch: options.fetch, ...options.webFetch, logger: options.logger });

  return {
    async query(input: AgentQueryCrawlInput): Promise<AgentQueryCrawlResult> {
      const query = sanitizeSearchQuery(input.query, options);
      const limit = Math.max(1, input.limit ?? DEFAULT_LIMITS.defaultCrawlPages);
      const resultsText = await search.search({
        query,
        signal: input.signal,
        numResults: input.search?.numResults ?? limit,
        type: input.search?.type,
        livecrawl: input.search?.livecrawl,
        contextMaxCharacters: input.search?.contextMaxCharacters,
        timeoutMs: input.search?.timeoutMs,
      });
      const urls = extractUrlsFromText(resultsText, options);
      const shouldCrawl = input.crawl?.enabled ?? true;
      const maxPages = Math.max(0, input.crawl?.maxPages ?? limit);
      const sources = shouldCrawl
        ? await crawlUrls({ urls: urls.slice(0, maxPages), webFetch, timeoutMs: input.crawl?.timeoutMs, signal: input.signal })
        : [];

      return { query, resultsText, urls, sources };
    },
  };
}

async function crawlUrls({
  urls,
  webFetch,
  timeoutMs,
  signal,
}: {
  urls: string[];
  webFetch: ReturnType<typeof createWebFetch>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<WebFetchResult[]> {
  const settled = await Promise.allSettled(urls.map((url) => webFetch.fetch({ url, timeoutMs, signal })));
  return settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
}
