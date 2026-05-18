export const DEFAULT_LIMITS = {
  maxWebResponseBytes: 5 * 1024 * 1024,
  webFetchTimeoutMs: 30_000,
  maxWebFetchTimeoutMs: 120_000,
  exaSearchTimeoutMs: 25_000,
  maxSearchTextCharacters: 4_000,
  maxSourceTextCharacters: 4_000,
  defaultSearchResults: 8,
  defaultCrawlPages: 5,
} as const;
