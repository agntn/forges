/**
 * Error normalization and custom error classes
 * Provides consistent error handling across different Git providers
 */

import { FetchError } from "ofetch";

/**
 * Base error class for forges operations
 */
export class ForgesError extends Error {
  status?: number;
  platform?: string;
  originalError?: Error;

  constructor(message: string, status?: number, platform?: string, originalError?: Error) {
    super(message);
    this.status = status;
    this.platform = platform;
    this.originalError = originalError;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, ForgesError.prototype);
  }
}

/**
 * Thrown when a resource is not found (404)
 */
export class NotFoundError extends ForgesError {
  constructor(message: string, platform?: string, originalError?: Error) {
    super(message, 404, platform, originalError);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Thrown when authentication fails (401)
 */
export class AuthenticationError extends ForgesError {
  constructor(message: string, platform?: string, originalError?: Error) {
    super(message, 401, platform, originalError);
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Thrown when the server understands the request but refuses to authorize it (403)
 */
export class PermissionError extends ForgesError {
  constructor(message: string, platform?: string, originalError?: Error) {
    super(message, 403, platform, originalError);
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

/**
 * Thrown when rate limit is exceeded (429)
 */
export class RateLimitError extends ForgesError {
  retryAfter?: number;

  constructor(message: string, retryAfter?: number, platform?: string, originalError?: Error) {
    super(message, 429, platform, originalError);
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Normalize FetchError or other errors into ForgesError hierarchy
 * Maps HTTP status codes to appropriate error types
 */
export function normalizeError(error: unknown, platform?: string): ForgesError {
  // Already a ForgesError
  if (error instanceof ForgesError) {
    return error;
  }

  // FetchError from ofetch
  if (error instanceof FetchError) {
    const status = error.status;
    const message = withProviderReason(error.message || `HTTP ${status}`, error);

    switch (status) {
      case 401:
        return new AuthenticationError(`Authentication failed: ${message}`, platform, error);
      case 403: {
        if (
          error.response?.headers?.get("x-ratelimit-remaining") === "0" ||
          error.response?.headers?.has("Retry-After") ||
          /rate limit/i.test(message)
        ) {
          const retryAfter = parseRetryAfter(error.response?.headers?.get("Retry-After"));
          return new RateLimitError(`Rate limit exceeded: ${message}`, retryAfter, platform, error);
        }
        return new PermissionError(`Permission denied: ${message}`, platform, error);
      }
      case 404:
        return new NotFoundError(`Resource not found: ${message}`, platform, error);
      case 429: {
        const retryAfter = parseRetryAfter(error.response?.headers?.get("Retry-After"));
        return new RateLimitError(`Rate limit exceeded: ${message}`, retryAfter, platform, error);
      }
      default:
        return new ForgesError(message, status, platform, error);
    }
  }

  // Generic Error
  if (error instanceof Error) {
    return new ForgesError(error.message, undefined, platform, error);
  }

  // Unknown error
  return new ForgesError(
    String(error),
    undefined,
    platform,
    error instanceof Error ? error : undefined,
  );
}

/** Longest provider reason a message repeats; the rest of a longer one is cut. */
const REASON_LIMIT = 200;

/** Body text read before masking; the token this cut splits is dropped whole. */
const REASON_SCAN = REASON_LIMIT * 8;

/** Items read from one list or field map of an error body. */
const REASON_ITEMS = 5;

/** The caller's address, which GitHub repeats in its rate limit text. */
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 =
  /(?<![\w:])(?:[\da-f]{1,4}:){3,7}[\da-f]{1,4}(?![\w:])|(?<![\w:])(?:[\da-f]{1,4}:)*[\da-f]{0,4}::(?:[\da-f]{1,4}(?::[\da-f]{1,4})*)?(?![\w:])/gi;
const USERINFO = /(\b[a-z][\w+.-]*:\/\/)[^\s/@]*@/gi;
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** ofetch's message stops at the status; the reason from the body goes after it. */
function withProviderReason(message: string, error: FetchError): string {
  const reason = providerReason(error.data);
  if (reason === undefined) return message;

  const said = reason.toLowerCase();
  const statusText = (error.statusText ?? "").toLowerCase();
  if (said === statusText || said === `${error.status} ${statusText}`) return message;
  return `${message.trimEnd()}: ${reason}`;
}

/**
 * `message`, GitLab's `error` and GitHub's `errors` as one printable line, without URL credentials.
 * An HTML page or plain text body gives no reason at all.
 */
function providerReason(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const body = data as Record<string, unknown>;

  const parts = [body.message, body.error, body.error_description].map(reasonText);
  if (Array.isArray(body.errors)) {
    parts.push(joinReasons(body.errors.slice(0, REASON_ITEMS).map(fieldError)));
  }

  const text = [...new Set(parts)]
    .filter((part) => part !== undefined)
    .join(": ")
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ");
  const reason = withoutCutToken(text, REASON_SCAN)
    .replace(USERINFO, "$1")
    .replace(IPV4, "<address>")
    .replace(IPV6, "<address>")
    .trim();
  if (!reason) return undefined;
  return reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT - 1).trimEnd()}…` : reason;
}

/** Half an address or credential would slip past the masks, so a split token goes whole. */
function withoutCutToken(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return text[limit] === " " ? cut : cut.replace(/\S*$/, "");
}

/** A string, a list of them, or GitLab's map from field to its errors. */
function reasonText(value: unknown): string | undefined {
  if (typeof value === "string" || Array.isArray(value)) return messages(value);
  if (typeof value !== "object" || value === null) return undefined;
  return joinReasons(
    Object.entries(value)
      .slice(0, REASON_ITEMS)
      .map(([field, errors]) => {
        const text = messages(errors);
        return text === undefined ? undefined : `${field} ${text}`;
      }),
  );
}

function messages(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!Array.isArray(value)) return undefined;
  return joinReasons(
    value.slice(0, REASON_ITEMS).map((item) => (typeof item === "string" ? item : undefined)),
  );
}

/** One entry of GitHub's `errors`: its own message, or the field and the code. */
function fieldError(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry || undefined;
  if (typeof entry !== "object" || entry === null) return undefined;
  const { message, field, code } = entry as Record<string, unknown>;
  if (typeof message === "string" && message) return message;
  if (typeof field === "string" && typeof code === "string") return `${field} ${code}`;
  return undefined;
}

function joinReasons(items: (string | undefined)[]): string | undefined {
  return items.filter((item) => item !== undefined && item !== "").join("; ") || undefined;
}

/**
 * Parse the Retry-After header value into delay seconds.
 * Handles both delay-seconds and HTTP-date formats (RFC 7231 §7.1.3).
 * Returns undefined for missing, empty, or unparseable values.
 */
function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isSafeInteger(seconds)) {
      return seconds;
    }
  }

  if (/[a-z]/i.test(trimmed)) {
    const date = Date.parse(trimmed);
    if (Number.isFinite(date)) {
      const delta = Math.ceil((date - Date.now()) / 1000);
      return delta > 0 ? delta : 0;
    }
  }

  return undefined;
}
