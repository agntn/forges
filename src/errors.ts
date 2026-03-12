/**
 * Error normalization and custom error classes
 * Provides consistent error handling across different Git providers
 */

import { FetchError } from 'ofetch';

/**
 * Base error class for gixa operations
 */
export class GixaError extends Error {
  constructor(
    message: string,
    public status?: number,
    public platform?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, GixaError.prototype);
  }
}

/**
 * Thrown when a resource is not found (404)
 */
export class NotFoundError extends GixaError {
  constructor(message: string, platform?: string, originalError?: Error) {
    super(message, 404, platform, originalError);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Thrown when authentication fails (401)
 */
export class AuthenticationError extends GixaError {
  constructor(message: string, platform?: string, originalError?: Error) {
    super(message, 401, platform, originalError);
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Thrown when rate limit is exceeded (429)
 */
export class RateLimitError extends GixaError {
  constructor(
    message: string,
    public retryAfter?: number,
    platform?: string,
    originalError?: Error
  ) {
    super(message, 429, platform, originalError);
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Normalize FetchError or other errors into GixaError hierarchy
 * Maps HTTP status codes to appropriate error types
 */
export function normalizeError(error: unknown, platform?: string): GixaError {
  // Already a GixaError
  if (error instanceof GixaError) {
    return error;
  }

  // FetchError from ofetch
  if (error instanceof FetchError) {
    const status = error.status;
    const message = error.message || `HTTP ${status}`;

    switch (status) {
      case 401:
        return new AuthenticationError(
          `Authentication failed: ${message}`,
          platform,
          error
        );
      case 404:
        return new NotFoundError(
          `Resource not found: ${message}`,
          platform,
          error
        );
      case 429: {
        const retryAfter = parseRetryAfter(
          error.response?.headers?.get('Retry-After')
        );
        return new RateLimitError(
          `Rate limit exceeded: ${message}`,
          retryAfter,
          platform,
          error
        );
      }
      default:
        return new GixaError(message, status, platform, error);
    }
  }

  // Generic Error
  if (error instanceof Error) {
    return new GixaError(error.message, undefined, platform, error);
  }

  // Unknown error
  return new GixaError(
    String(error),
    undefined,
    platform,
    error instanceof Error ? error : undefined
  );
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
