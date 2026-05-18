import { describe, expect, test, vi } from 'vitest';
import { createAgentQueryCrawl } from '../src/agent-query-crawl';

describe('agent query crawl', () => {
  test('searches, extracts urls, and crawls limited sources', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('data: {"result":{"content":[{"type":"text","text":"A https://example.com/a B https://example.com/b C https://example.com/c"}]}}\n', { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('<html><body>A page</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('B page', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    const crawler = createAgentQueryCrawl({ fetch, logger: false });

    const result = await crawler.query({ query: 'test query', limit: 3, crawl: { maxPages: 2 } });

    expect(result.query).toBe('test query');
    expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
    expect(result.sources.map((source) => source.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('can skip crawling', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('data: {"result":{"content":[{"type":"text","text":"A https://example.com/a"}]}}\n', { status: 200 }),
    );
    const crawler = createAgentQueryCrawl({ fetch, logger: false });

    const result = await crawler.query({ query: 'test query', crawl: { enabled: false } });

    expect(result.sources).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
