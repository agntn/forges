/**
 * HTTP client factory over native fetch
 * Provides configurable authentication, retry logic, and rate limit awareness
 */

import { sha256 } from "@agntn/hashes/sha2";
import { CACHE_SCOPE } from "./cache.ts";
import { FetchError } from "./errors.ts";
import { version } from "./version.ts";

/**
 * Configuration for HTTP client
 */
export interface HttpClientConfig {
  baseURL: string;
  token: string;
  tokenHeader?: string; // e.g., 'Authorization', 'Private-Token'
  tokenPrefix?: string; // e.g., 'token ', 'Bearer '
  userAgent?: string;
}

/** How a response body is read: parsed JSON (the default), text, binary, or the stream itself. */
export type ResponseType = "json" | "text" | "blob" | "arrayBuffer" | "stream";

/** What a request resolves to for each {@link ResponseType}. `T` types parsed JSON. */
export type ResponseData<R extends ResponseType, T> = R extends "text"
  ? string
  : R extends "blob"
    ? Blob
    : R extends "arrayBuffer"
      ? ArrayBuffer
      : R extends "stream"
        ? ReadableStream<Uint8Array>
        : T;

/** Options of one request made through an {@link HttpClient}. */
export interface RequestOptions<R extends ResponseType = ResponseType> {
  method?: string;
  /** Appended to the URL. `undefined` values are left out, an array repeats its key. */
  query?: Record<string, unknown>;
  /** A plain object or array goes out as JSON. Anything else goes to fetch as it is. */
  body?: unknown;
  headers?: ConstructorParameters<typeof Headers>[0];
  /** Read from the response's `Content-Type` when left out: JSON, text, otherwise a Blob. */
  responseType?: R;
  /** Attempts after the first: 2 for a read, 0 for a write so it is never replayed. */
  retry?: number | false;
  /** Milliseconds between attempts. */
  retryDelay?: number;
  /** Statuses worth another attempt. A failure with no response counts as 500. */
  retryStatusCodes?: readonly number[];
  signal?: AbortSignal;
}

/**
 * Response data and metadata returned by {@link rawFetch}.
 */
export interface RawFetchResult<T> {
  data: T | undefined;
  headers: Headers;
  status: number;
}

/** Resolves to the response data, and `raw` adds the headers and status. */
export interface HttpClient {
  <T = unknown, R extends ResponseType = "json">(
    url: string,
    options?: RequestOptions<R>,
  ): Promise<ResponseData<R, T>>;
  raw<T = unknown, R extends ResponseType = "json">(
    url: string,
    options?: RequestOptions<R>,
  ): Promise<RawFetchResult<ResponseData<R, T>>>;
}

const PAYLOAD_METHODS = new Set(["PATCH", "POST", "PUT", "DELETE"]);

const RETRY_STATUS_CODES: readonly number[] = [408, 409, 425, 429, 500, 502, 503, 504];

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const JSON_TYPE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json$/i;

const TEXT_TYPES = new Set([
  "image/svg",
  "application/xml",
  "application/xhtml",
  "application/html",
]);

/** Create a client with auth headers, retries and rate limit warnings. */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  const {
    baseURL,
    token,
    tokenHeader = "Authorization",
    tokenPrefix = "token ",
    userAgent = `forges/${version}`,
  } = config;

  /** An empty token sends no auth header: unauthenticated reads are intentional. */
  async function raw(url: string, options: RequestOptions = {}): Promise<RawFetchResult<unknown>> {
    const method = (options.method ?? "GET").toUpperCase();
    const target = options.query
      ? withQuery(withBase(url, baseURL), options.query)
      : withBase(url, baseURL);

    const headers = new Headers({ "User-Agent": userAgent });
    for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
    if (token) headers.set(tokenHeader, tokenPrefix ? `${tokenPrefix}${token}` : token);

    let body = options.body;
    if (body && PAYLOAD_METHODS.has(method) && isJSONBody(body)) {
      if (typeof body !== "string") body = JSON.stringify(body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      if (!headers.has("accept")) headers.set("accept", "application/json");
    }

    const retries =
      options.retry === false ? 0 : (options.retry ?? (PAYLOAD_METHODS.has(method) ? 0 : 2));
    const retryStatusCodes = options.retryStatusCodes ?? RETRY_STATUS_CODES;
    const retryDelay = options.retryDelay ?? 1000;
    const init: RequestInit = {
      method,
      headers,
      body: body as RequestInit["body"],
      signal: options.signal,
    };

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(target, init);
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        if (!aborted && attempt < retries && retryStatusCodes.includes(500)) {
          await delay(retryDelay);
          continue;
        }
        throw requestError(method, target, options, undefined, undefined, error);
      }

      const data = await readBody(response, method, options.responseType);
      if (response.status < 400 || response.status >= 600) {
        return { data, headers: response.headers, status: response.status };
      }

      warnOnLowRateLimit(response.headers);
      if (attempt < retries && retryStatusCodes.includes(response.status)) {
        await delay(retryDelay);
        continue;
      }
      throw requestError(method, target, options, response, data);
    }
  }

  const client = (async (url: string, options?: RequestOptions) =>
    (await raw(url, options)).data) as HttpClient;

  // Cache storage is process-global, so tag this client with the identity its
  // responses belong to. The token is hashed: cache keys can reach an external
  // storage backend and must never carry the raw credential.
  const credential = Buffer.from(sha256(Buffer.from(token))).toString("hex", 0, 8);
  return Object.assign(client, {
    raw: raw as HttpClient["raw"],
    [CACHE_SCOPE]: `${baseURL}#${credential}`,
  });
}

/** Like a client call, but keeps the headers and status that pagination reads. */
export function rawFetch<T = unknown, R extends ResponseType = "json">(
  client: HttpClient,
  url: string,
  options?: RequestOptions<R>,
): Promise<RawFetchResult<ResponseData<R, T>>> {
  return client.raw<T, R>(url, options);
}

/** A path joins the base URL. A URL that already starts with it stays as it is. */
function withBase(url: string, baseURL: string): string {
  const base = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  if (!base || url.startsWith(base)) return url;
  if (!url || url === "/") return base;
  return `${base}/${url.replace(/^\.?\//u, "")}`;
}

/** Merge query values into the URL. A key given here replaces the same key already in it. */
function withQuery(url: string, query: Record<string, unknown>): string {
  const hash = url.indexOf("#");
  const fragment = hash === -1 ? "" : url.slice(hash);
  const rest = hash === -1 ? url : url.slice(0, hash);
  const mark = rest.indexOf("?");
  const path = mark === -1 ? rest : rest.slice(0, mark);
  const params = new URLSearchParams(mark === -1 ? "" : rest.slice(mark + 1));

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, queryValue(item));
    }
  }

  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}${fragment}`;
}

function queryValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Plain objects, arrays and primitives go out as JSON. FormData, streams and buffers don't. */
function isJSONBody(body: unknown): boolean {
  const type = typeof body;
  if (type === "string" || type === "number" || type === "boolean") return true;
  if (type !== "object" || body === null) return false;
  if (Array.isArray(body)) return true;
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) return false;
  if (body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob)
    return false;
  if (body instanceof ReadableStream) return false;
  const proto: unknown = Object.getPrototypeOf(body);
  return (
    proto === Object.prototype ||
    proto === null ||
    typeof (body as { toJSON?: unknown }).toJSON === "function"
  );
}

async function readBody(
  response: Response,
  method: string,
  responseType: ResponseType | undefined,
): Promise<unknown> {
  if (!response.body || NULL_BODY_STATUSES.has(response.status) || method === "HEAD") {
    return undefined;
  }
  switch (responseType ?? detectResponseType(response.headers.get("content-type"))) {
    case "json": {
      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    case "stream":
      return response.body;
    case "text":
      return response.text();
    case "arrayBuffer":
      return response.arrayBuffer();
    case "blob":
      return response.blob();
  }
}

function detectResponseType(contentType: string | null): ResponseType {
  const type = (contentType ?? "").split(";")[0]?.trim() ?? "";
  if (!type || JSON_TYPE.test(type)) return "json";
  if (type === "text/event-stream") return "stream";
  if (TEXT_TYPES.has(type) || type.startsWith("text/")) return "text";
  return "blob";
}

function warnOnLowRateLimit(headers: Headers): void {
  const remaining = headers.get("X-RateLimit-Remaining");
  if (remaining === null) return;
  const remainingCount = parseInt(remaining, 10);
  if (remainingCount < 10) {
    console.warn(`[forges] Rate limit warning: ${remainingCount} requests remaining`);
  }
}

/** The `[METHOD] "<url>": <status>` message is the shape endpoint redaction expects. */
function requestError(
  method: string,
  url: string,
  options: RequestOptions,
  response: Response | undefined,
  data: unknown,
  cause?: unknown,
): FetchError {
  const status = response ? `${response.status} ${response.statusText}` : "<no response>";
  const reason = cause instanceof Error ? cause.message : cause === undefined ? "" : String(cause);
  const error = new FetchError(
    `[${method}] ${JSON.stringify(url)}: ${status}${reason ? ` ${reason}` : ""}`,
    cause === undefined ? undefined : { cause },
  );
  error.request = url;
  error.options = options;
  error.response = response;
  error.data = data;
  error.status = response?.status;
  error.statusCode = response?.status;
  error.statusText = response?.statusText;
  error.statusMessage = response?.statusText;
  return error;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export { FetchError };
