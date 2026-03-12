import { describe, it, expect } from 'vitest';
import { FetchError } from 'ofetch';
import {
  normalizeError,
  GixaError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from '../src/errors';

function createFetchError(
  message: string,
  status: number,
  responseHeaders?: Record<string, string>,
): FetchError {
  const error = new FetchError(message);
  error.status = status;
  error.statusCode = status;
  if (responseHeaders) {
    error.response = { headers: new Headers(responseHeaders) } as any;
  }
  return error;
}

describe('normalizeError', () => {
  it('maps 401 FetchError to AuthenticationError', () => {
    const err = createFetchError('Unauthorized', 401);
    const result = normalizeError(err, 'github');

    expect(result).toBeInstanceOf(AuthenticationError);
    expect(result.status).toBe(401);
    expect(result.platform).toBe('github');
    expect(result.message).toContain('Authentication failed');
    expect(result.originalError).toBe(err);
  });

  it('maps 404 FetchError to NotFoundError', () => {
    const err = createFetchError('Not Found', 404);
    const result = normalizeError(err, 'gitea');

    expect(result).toBeInstanceOf(NotFoundError);
    expect(result.status).toBe(404);
    expect(result.platform).toBe('gitea');
    expect(result.message).toContain('Resource not found');
  });

  it('maps 429 FetchError to RateLimitError with retryAfter', () => {
    const err = createFetchError('Too Many Requests', 429, { 'Retry-After': '60' });
    const result = normalizeError(err, 'github');

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.status).toBe(429);
    expect(result.message).toContain('Rate limit exceeded');
    expect((result as RateLimitError).retryAfter).toBe(60);
  });

  it('maps 429 with whitespace-wrapped numeric Retry-After', () => {
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': ' 60 ',
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBe(60);
  });

  it('maps 429 FetchError without Retry-After header', () => {
    const err = createFetchError('Too Many Requests', 429);
    const result = normalizeError(err, 'gitlab');

    expect(result).toBeInstanceOf(RateLimitError);
    expect((result as RateLimitError).retryAfter).toBeUndefined();
  });

  it('maps 429 with HTTP-date Retry-After to delay seconds', () => {
    const futureDate = new Date(Date.now() + 120_000).toUTCString();
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': futureDate,
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeTypeOf('number');
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(120);
  });

  it('maps 429 with past HTTP-date Retry-After to zero', () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': pastDate,
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBe(0);
  });

  it('maps 429 with whitespace-wrapped HTTP-date Retry-After', () => {
    const futureDate = new Date(Date.now() + 120_000).toUTCString();
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': ` ${futureDate} `,
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeTypeOf('number');
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(120);
  });

  it('maps 429 with non-numeric Retry-After to undefined', () => {
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': 'not-a-number',
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it('maps 429 with partially numeric Retry-After to undefined', () => {
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': '60s',
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it('maps 429 with exponent-like Retry-After to undefined', () => {
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': '1e3',
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it('maps 429 with comma-formatted Retry-After to undefined', () => {
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': '10,000',
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it('maps 429 with negative Retry-After to undefined', () => {
    const err = createFetchError('Too Many Requests', 429, {
      'Retry-After': '-5',
    });
    const result = normalizeError(err, 'github') as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it('maps other HTTP status to generic GixaError', () => {
    const err = createFetchError('Internal Server Error', 500);
    const result = normalizeError(err, 'github');

    expect(result).toBeInstanceOf(GixaError);
    expect(result).not.toBeInstanceOf(AuthenticationError);
    expect(result).not.toBeInstanceOf(NotFoundError);
    expect(result).not.toBeInstanceOf(RateLimitError);
    expect(result.status).toBe(500);
  });

  it('wraps generic Error in GixaError', () => {
    const err = new Error('Network failure');
    const result = normalizeError(err, 'gitea');

    expect(result).toBeInstanceOf(GixaError);
    expect(result.message).toBe('Network failure');
    expect(result.status).toBeUndefined();
    expect(result.originalError).toBe(err);
  });

  it('passes through existing GixaError unchanged', () => {
    const original = new NotFoundError('Already normalized', 'github');
    const result = normalizeError(original);

    expect(result).toBe(original);
  });

  it('converts unknown error types to GixaError', () => {
    const result = normalizeError('string error', 'github');

    expect(result).toBeInstanceOf(GixaError);
    expect(result.message).toBe('string error');
    expect(result.platform).toBe('github');
  });
});
