/**
 * Error normalization and custom error classes
 * Provides consistent error handling across different Git providers
 */

import { FetchError } from "ofetch";

/**
 * Base error class for gixa operations
 */
export class GixaError extends Error {
  constructor(
    message: string,
    public status?: number,
    public platform?: string,
    public originalError?: Error,
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
    originalError?: Error,
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
        return new AuthenticationError(`Authentication failed: ${message}`, platform, error);
      case 404:
        return new NotFoundError(`Resource not found: ${message}`, platform, error);
      case 429:
        const retryAfter = error.response?.headers?.get("Retry-After");
        return new RateLimitError(
          `Rate limit exceeded: ${message}`,
          retryAfter ? parseInt(retryAfter, 10) : undefined,
          platform,
          error,
        );
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
    error instanceof Error ? error : undefined,
  );
}
