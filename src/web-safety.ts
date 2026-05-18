import { AgentQueryCrawlError } from './errors';

/**
 * Patterns that trigger rejection of a search query.
 *
 * These patterns detect prompt injection attempts, secret-seeking queries,
 * and other attempts to manipulate the LLM or extract sensitive information.
 * The list is intentionally broad to catch variations of these attacks.
 */
const PROHIBITED_QUERY_PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /disregard\s+(?:all\s+)?previous/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /assistant\s+instructions/i,
  /prompt\s+injection/i,
  /jailbreak/i,
  /reveal\s+secrets?/i,
  /api\s+key/i,
  /password/i,
  /credentials?/i,
  /\btoken\b/i,
];

export type SafetyOptions = {
  /** Optional logger used when a URL or query is rejected. */
  logger?: Pick<Console, 'warn'> | false;
};

/**
 * Validate an HTTPS URL and reject local/private network targets.
 *
 * Allows only HTTPS URLs, rejects embedded credentials, and blocks private
 * IP ranges (including localhost, IPv4 private/reserved ranges, and link-local).
 * URL hashes are stripped to prevent hash-based payload bypass.
 *
 * @param kind - Identifier for logging (e.g., 'webfetch', 'exa result')
 * @throws AgentQueryCrawlError when URL fails any safety check
 */
export function validateSafeHttpsUrl(value: string, kind = 'webfetch', options: SafetyOptions = {}): string {
  const trimmed = value.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    logUnsafeWebAttempt(`unsafe ${kind} URL`, 'malformed URL', trimmed, options);
    throw new AgentQueryCrawlError('unsupported', 'Unsafe URL: malformed URL.');
  }

  const reason = unsafeUrlReason(parsed);
  if (reason) {
    logUnsafeWebAttempt(`unsafe ${kind} URL`, reason, trimmed, options);
    throw new AgentQueryCrawlError('unsupported', `Unsafe URL: ${reason}.`);
  }

  parsed.hash = '';
  return parsed.href;
}

/**
 * Normalize a web search query and reject prompt-injection or secret-seeking phrases.
 *
 * Normalizes whitespace and control characters, truncates to 500 characters,
 * then checks against prohibited patterns. Throws if the query is empty after
 * normalization or matches any injection/secret-seeking pattern.
 *
 * @throws AgentQueryCrawlError when query is empty or matches a prohibited pattern
 */
export function sanitizeSearchQuery(value: string, options: SafetyOptions = {}): string {
  const query = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const pattern = PROHIBITED_QUERY_PATTERNS.find((item) => item.test(query));
  if (pattern) {
    logUnsafeWebAttempt('unsafe websearch query', `prohibited phrase ${pattern.source}`, query, options);
    throw new AgentQueryCrawlError('unsupported', 'Unsafe search query: prohibited phrase.');
  }

  if (!query) {
    throw new AgentQueryCrawlError('unsupported', 'Search query is empty.');
  }

  return query;
}

/**
 * Sanitize untrusted web text before handing it to an agent or model.
 *
 * Removes control characters, strips markdown/HTML formatting characters,
 * removes role-playing prefixes (system:, user:, etc.), and eliminates
 * prompt injection phrases. Also removes potentially dangerous content like
 * API keys, passwords, and tokens. Finally truncates to maxLength.
 *
 * This is a defense-in-depth measure - content should already be safe from
 * the source, but this catches any edge cases that slip through.
 */
export function sanitizeUntrustedWebText(value: string, maxLength = 4000): string {
  return value
    .replace(/<\s*\//g, '<')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[`*_~^|\[\]{}<>]+/g, ' ')
    .replace(/\b(system|user|assistant|developer)\s*:/gi, ' ')
    .replace(/ignore\s+(?:all\s+)?previous(?:\s+instructions?)?/gi, ' ')
    .replace(/disregard\s+(?:all\s+)?previous(?:\s+instructions?)?/gi, ' ')
    .replace(/system\s+prompt/gi, ' ')
    .replace(/developer\s+message/gi, ' ')
    .replace(/assistant\s+instructions/gi, ' ')
    .replace(/prompt\s+injection/gi, ' ')
    .replace(/jailbreak/gi, ' ')
    .replace(/reveal\s+secrets?/gi, ' ')
    .replace(/api\s+key|password|credentials?|\btoken\b/gi, ' ')
    .replace(/[()]+/g, ' ')
    .replace(/[^A-Za-z0-9\s.,;:/%+&'/?=\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Log a rejected web query or URL without leaking the full target. */
export function logUnsafeWebAttempt(kind: string, reason: string, value: string, options: SafetyOptions = {}): void {
  if (options.logger === false) return;
  const logger = options.logger ?? console;
  logger.warn(`[agent-query-crawl] Blocked ${kind}:`, `${reason}; target=${redactedTarget(value)}`);
}

function unsafeUrlReason(parsed: URL): string | null {
  if (parsed.protocol !== 'https:') return 'only HTTPS URLs are allowed';
  if (parsed.username || parsed.password) return 'credentials in URLs are not allowed';

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) return 'missing hostname';
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return 'local hostnames are not allowed';
  if (hostname.includes(':')) return 'IP literals are not allowed';

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isUnsafeIpv4(ipv4)) return 'private or reserved IP addresses are not allowed';

  return null;
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isUnsafeIpv4([a, b, c, d]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function redactedTarget(value: string): string {
  try {
    const parsed = new URL(value.trim());
    return `${parsed.protocol}//${parsed.hostname || 'unknown'}`;
  } catch {
    return '[redacted]';
  }
}
