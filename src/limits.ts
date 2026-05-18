/**
 * Default limits for various operations.
 *
 * These limits protect against resource exhaustion and provide reasonable
 * defaults for web requests, search results, and content processing.
 */
export const DEFAULT_LIMITS = {
  /** Maximum allowed response size for web fetches (5MB). */
  maxWebResponseBytes: 5 * 1024 * 1024,
  /** Default timeout for individual web fetches (30 seconds). */
  webFetchTimeoutMs: 30_000,
  /** Maximum allowed timeout for web fetches even if explicitly requested (2 minutes). */
  maxWebFetchTimeoutMs: 120_000,
  /** Timeout for Exa search requests (25 seconds). */
  exaSearchTimeoutMs: 25_000,
  /** Maximum length of sanitized search result text. */
  maxSearchTextCharacters: 4_000,
  /** Maximum length of sanitized crawled page text. */
  maxSourceTextCharacters: 4_000,
  /** Default number of search results to request from Exa. */
  defaultSearchResults: 8,
  /** Default number of pages to crawl when no limit is specified. */
  defaultCrawlPages: 5,
} as const;
