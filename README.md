# agent-query-crawl

Agent-oriented internet query, Exa search, and safe page crawling utilities.

`agent-query-crawl` turns a natural-language query into sanitized Exa search output, extracts safe HTTPS URLs, optionally crawls a limited set of pages, and returns agent-ready text snippets. It is retrieval infrastructure, not an LLM wrapper.

## Install

```bash
npm install agent-query-crawl
```

## Quick Start

```ts
import { createAgentQueryCrawl } from 'agent-query-crawl';

const crawler = createAgentQueryCrawl();

const result = await crawler.query({
  query: 'Phoenix Contact 2865463 manufacturer datasheet',
  limit: 5,
});

console.log(result.resultsText);
console.log(result.urls);
console.log(result.sources.map((source) => source.text));
```

## Query Options

```ts
const result = await crawler.query({
  query: 'Siemens 3RW4027-2BB04 official datasheet',
  limit: 8,
  search: {
    type: 'auto',
    livecrawl: 'fallback',
    contextMaxCharacters: 3000,
  },
  crawl: {
    enabled: true,
    maxPages: 3,
    timeoutMs: 10_000,
  },
});
```

Result shape:

```ts
type AgentQueryCrawlResult = {
  query: string;
  resultsText: string;
  urls: string[];
  sources: {
    url: string;
    contentType: string;
    text: string;
  }[];
};
```

## Lower-Level APIs

```ts
import { createExaSearch, createWebFetch, extractUrlsFromText } from 'agent-query-crawl';

const search = createExaSearch();
const resultsText = await search.search({ query: 'OpenAI Codex docs', numResults: 5 });

const urls = extractUrlsFromText(resultsText);

const webFetch = createWebFetch();
const page = await webFetch.fetch({ url: urls[0] });
```

## Proxy Handlers

Use proxy handlers when browser runtimes should not call Exa or arbitrary web pages directly.

```ts
import { createAgentQueryCrawlProxy } from 'agent-query-crawl/proxy';

const proxy = createAgentQueryCrawlProxy();

export const exaMcp = proxy.exaMcp;
export const webFetch = proxy.webFetch;
```

The `webFetch` proxy expects `?url=https%3A%2F%2Fexample.com%2Fpage`.

## Safety Model

The package is designed for agent retrieval, so it aggressively sanitizes inputs and outputs.

- Search queries are normalized and checked for prompt-injection and secret-seeking phrases.
- Only HTTPS page URLs are allowed.
- URLs with credentials are rejected.
- Localhost, `.local`, IP literals, private IPv4, and reserved IPv4 ranges are rejected.
- URL hashes are stripped before fetching.
- HTML is converted to plain text.
- Untrusted web text is stripped of role labels, prompt-injection phrases, markdown control characters, and unusual symbols.
- Fetches are timeout-limited.
- Page responses are size-limited to 5MB by default.
- Proxy responses use `Cache-Control: no-store`.

This is still a crawler. You should use it only in environments where outbound web requests are allowed and expected.

## API

### `createAgentQueryCrawl(options)`

Creates the high-level query and crawl client.

Important options:

- `fetch`: custom fetch implementation.
- `search`: options passed to `createExaSearch`.
- `webFetch`: options passed to `createWebFetch`.
- `logger`: custom warning logger or `false` to disable safety logs.

### `createExaSearch(options)`

Creates an Exa MCP search client.

Defaults:

- endpoint: `https://mcp.exa.ai/mcp`
- tool: `web_search_exa`
- type: `auto`
- numResults: `8`
- livecrawl: `fallback`

### `createWebFetch(options)`

Creates a safe page fetcher with browser-like headers, HTML-to-text conversion, timeout handling, and size limits.

### `createAgentQueryCrawlProxy(options)`

Creates framework-agnostic proxy handlers for Exa MCP and safe web fetches.

## Notes

- Exa availability and result quality depend on Exa's public MCP endpoint.
- This package does not summarize or reconcile evidence with an LLM. Feed `resultsText` and `sources` into your agent/model as retrieval context.
- The crawler silently drops individual source pages that fail during high-level `query()` crawling, while lower-level `webFetch.fetch()` throws detailed errors.
