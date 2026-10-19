/**
 * The HTTP client providers call, sent through a `forges` provider.
 *
 * `forges` owns the transport: credentials, which go only to the API origin,
 * redirects, timeouts and rate limits. This module keeps the call shape the
 * providers already use, and turns a `forges` failure back into a
 * {@link FetchError}, so `normalizeError` reads it the way it always did.
 */

import { Buffer } from "node:buffer";
import { sha256 } from "@agntn/hashes/sha2";
import type { FetchLike, ForgeProvider as Forge, RawResponse } from "forges";

import { CACHE_SCOPE } from "./cache.ts";
import { FetchError, ForgesError } from "./errors.ts";

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
  /** Milliseconds between attempts, unless the server asks for a longer wait. */
  retryDelay?: number;
  /** Statuses worth another attempt. No response counts as 500. */
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

/** The reason phrases `normalizeError` compares a forge's message with. */
const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  425: "Too Early",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** A cache scope for one API base and credential; the token is hashed so no key carries it. */
export function credentialScope(baseURL: string, token: string): string {
  return `${baseURL}#${Buffer.from(sha256(Buffer.from(token))).toString("hex", 0, 8)}`;
}

/** Where a client sends its requests, and what keeps its cached responses apart. */
export interface ForgeClientOptions {
  /** Keeps cached responses of one origin and credential apart from the rest. */
  scope: string;
  /** Put in front of every path that is not a whole URL, such as an account route. */
  prefix?: string;
}

/** A client on the `forges` provider `open` resolves; reads retry twice, writes never. */
export function createForgeClient(
  open: () => Promise<Forge>,
  client: ForgeClientOptions,
): HttpClient {
  const prefix = client.prefix?.replace(/\/+$/u, "") ?? "";

  async function raw(url: string, options: RequestOptions = {}): Promise<RawFetchResult<unknown>> {
    const method = (options.method ?? "GET").toUpperCase();
    const path = prefix && !URL.canParse(url) ? `${prefix}/${url.replace(/^\/+/u, "")}` : url;
    const target = options.query ? withQuery(path, options.query) : path;
    const headers = Object.fromEntries(new Headers(options.headers));
    const retries =
      options.retry === false ? 0 : (options.retry ?? (PAYLOAD_METHODS.has(method) ? 0 : 2));
    const retryStatusCodes = options.retryStatusCodes ?? RETRY_STATUS_CODES;
    const retryDelay = options.retryDelay ?? 1000;
    const forge = await open();

    for (let attempt = 0; ; attempt++) {
      let response: RawResponse;
      try {
        response = await forge.request(method, target, {
          raw: true,
          body: options.body,
          headers,
          signal: options.signal,
        });
      } catch (error) {
        const failure = toFetchError(error, { method, url: target, options });
        const wait = retryWait(failure, { signal: options.signal, retryStatusCodes });
        if (attempt < retries && wait !== undefined) {
          await delay(Math.max(retryDelay, wait), options.signal);
          continue;
        }
        throw failure;
      }
      let data: unknown;
      try {
        data = await readBody(response, { method, responseType: options.responseType });
      } catch (cause) {
        if (attempt < retries && !options.signal?.aborted && retryStatusCodes.includes(500)) {
          await delay(retryDelay, options.signal);
          continue;
        }
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw fetchError(`${response.status} ${reason}`, {
          cause,
          method,
          url: target,
          options,
          status: response.status,
        });
      }
      return { data, headers: response.headers, status: response.status };
    }
  }

  const send = (async (url: string, options?: RequestOptions) =>
    (await raw(url, options)).data) as HttpClient;
  return Object.assign(send, { raw: raw as HttpClient["raw"], [CACHE_SCOPE]: client.scope });
}

/** Milliseconds before another try, or none for an abort, a final status or a rate limit. */
function retryWait(
  failure: unknown,
  retry: Readonly<{ signal: AbortSignal | undefined; retryStatusCodes: readonly number[] }>,
): number | undefined {
  const { signal, retryStatusCodes } = retry;
  if (signal?.aborted || !(failure instanceof FetchError)) return undefined;
  if ((failure.cause as Error | undefined)?.name === "RateLimitedError") return undefined;
  return retryStatusCodes.includes(failure.status ?? 500) ? 0 : undefined;
}

/** Ends early on abort, so the next attempt fails on the signal instead of sleeping through it. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Fetch for every `forges` provider here: a refusal with a cut body keeps its status. */
export const forgeFetch: FetchLike = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  if (response.status < 400 || response.status > 599 || response.body === null) return response;
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

/** Like a client call, but keeps the headers and status that pagination reads. */
export function rawFetch<T = unknown, R extends ResponseType = "json">(
  client: HttpClient,
  url: string,
  options?: RequestOptions<R>,
): Promise<RawFetchResult<ResponseData<R, T>>> {
  return client.raw<T, R>(url, options);
}

/** The fields a `forges` failure carries, read without importing its classes. */
interface ForgeFailure extends Error {
  status?: number;
  method?: string;
  url?: string;
  body?: string;
  resetAt?: Date;
}

/** The request a failure answered, when the caller knows it better than the failure does. */
export interface FailedRequest {
  method?: string;
  url?: string;
  options?: object;
}

/** A `forges` failure as the {@link FetchError} that `normalizeError` and redaction read. */
export function toFetchError(error: unknown, request: FailedRequest = {}): unknown {
  if (!(error instanceof Error) || error instanceof FetchError || error instanceof ForgesError) {
    return error;
  }
  const failure = error as ForgeFailure;
  const method = request.method ?? failure.method ?? "GET";
  const url = failure.url ?? request.url ?? "";
  const { options } = request;
  if (typeof failure.status !== "number") {
    if (failure.name !== "ForgeNetworkError" && failure.name !== "ForgeTimeoutError") return error;
    return fetchError(`<no response> ${error.message}`, { cause: error, method, url, options });
  }
  const status = failure.status;
  const statusText = STATUS_TEXT[status] ?? "";
  const headers = new Headers();
  const wait = secondsUntil(failure.resetAt);
  if (wait !== undefined) headers.set("Retry-After", String(wait));
  const result = fetchError(`${status} ${statusText}`.trimEnd(), {
    cause: error,
    method,
    url,
    options,
    status,
  });
  result.response = { status, statusText, headers } as Response;
  result.data = parseBody(failure.body);
  result.statusText = statusText;
  result.statusMessage = statusText;
  return result;
}

/** A failed request with what went wrong underneath it and the status, when one came back. */
interface Failure extends FailedRequest {
  cause: unknown;
  method: string;
  url: string;
  status?: number;
}

/** A {@link FetchError} worded `[METHOD] "<url>": <detail>`, the shape redaction knows to strip. */
function fetchError(detail: string, failure: Failure): FetchError {
  const { cause, method, url, options, status } = failure;
  const error = new FetchError(`[${method}] ${JSON.stringify(url)}: ${detail}`, { cause });
  error.request = url;
  error.options = { ...options, method };
  error.status = status;
  error.statusCode = status;
  return error;
}

/** `forges` keeps the first 512 characters of a failed body; a cut JSON body stays text. */
function parseBody(body: string | undefined): unknown {
  if (body === undefined || body === "") return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function secondsUntil(date: Date | undefined): number | undefined {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
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

/** Only a success gets here, read the way the call asked; `forges` threw any failure. */
async function readBody(
  response: RawResponse,
  request: Readonly<{ method: string; responseType: ResponseType | undefined }>,
): Promise<unknown> {
  const { method, responseType } = request;
  if (!response.body || NULL_BODY_STATUSES.has(response.status) || method === "HEAD") {
    await response.body?.cancel();
    return undefined;
  }
  const type = responseType ?? detectResponseType(response.headers.get("content-type"));
  if (type === "stream") return response.body;
  const body = new Response(response.body, { headers: response.headers });
  switch (type) {
    case "json": {
      const text = await body.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    case "text":
      return body.text();
    case "arrayBuffer":
      return body.arrayBuffer();
    case "blob":
      return body.blob();
  }
}

function detectResponseType(contentType: string | null): ResponseType {
  const type = (contentType ?? "").split(";")[0]?.trim() ?? "";
  if (!type || JSON_TYPE.test(type)) return "json";
  if (type === "text/event-stream") return "stream";
  if (TEXT_TYPES.has(type) || type.startsWith("text/")) return "text";
  return "blob";
}

export { FetchError };
