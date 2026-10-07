/**
 * Error normalization and custom error classes
 * Provides consistent error handling across different Git providers
 */

/** A refused request, or one with no response, whose transport failure is then the `cause`. */
export class FetchError<T = unknown> extends Error {
  request?: string;
  options?: object;
  response?: Response;
  data?: T;
  status?: number;
  statusCode?: number;
  statusText?: string;
  statusMessage?: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FetchError";
  }
}

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
 * Normalize a FetchError or another error into the ForgesError hierarchy
 * Maps HTTP status codes to appropriate error types
 */
export function normalizeError(error: unknown, platform?: string): ForgesError {
  const normalized = classifyError(error, platform);
  if (!(error instanceof FetchError) || !unsettledWrite(error)) return normalized;
  return withHint(normalized, UNSETTLED_WRITE);
}

function classifyError(error: unknown, platform?: string): ForgesError {
  // Already a ForgesError
  if (error instanceof ForgesError) {
    return error;
  }

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

/**
 * A refused merge also says what to check before trying again. Gitea answers 405
 * with an empty body, so the status alone would be all a caller learns, and it
 * answers 409 for a conflict too, so only a merge that named a head blames it.
 */
export function normalizeMergeError(
  error: unknown,
  platform: string,
  pinnedHead: boolean,
): ForgesError {
  const normalized = classifyError(error, platform);
  const hint =
    normalized.originalError instanceof FetchError && unsettledWrite(normalized.originalError)
      ? UNSETTLED_MERGE
      : normalized.status === 405
        ? "The pull request cannot be merged as it stands: it may be closed, a draft, in conflict, waiting on required checks or approvals, or the merge method may be off for this repository. Read the pull request and its checks before trying again."
        : normalized.status !== 409
          ? undefined
          : pinnedHead
            ? "The head commit may no longer be headSha. Read the pull request again and review any new commits before merging."
            : "The branches conflict or the head moved during the merge. Read the pull request again before trying again.";
  return hint === undefined ? normalized : withHint(normalized, hint);
}

/** The merge went through, so a failed read of its result must not invite a second one. */
export function normalizeMergedReadError(error: unknown, platform: string): ForgesError {
  return withHint(classifyError(error, platform), MERGED_READ);
}

const MERGED_READ =
  "The merge went through, but reading the pull request back failed. Read it again instead of merging a second time.";

const UNSETTLED_WRITE =
  "The write may have landed before this failure, so check for its result before sending it again.";

const UNSETTLED_MERGE =
  "The merge may have landed before this failure, so read the pull request's merged and mergeCommitSha before trying again.";

const WRITE_METHODS = new Set(["PATCH", "POST", "PUT", "DELETE"]);

/** Connection failures that stop a request before any byte of it reaches the forge. */
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

/** GraphQL reads go out as POST too, so only a document defining a mutation counts as a write. */
function isWrite(error: FetchError): boolean {
  const { method = "GET", body } = (error.options ?? {}) as { method?: string; body?: unknown };
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  if (!/\/graphql(?:[?#]|$)/u.test(error.request ?? "")) return true;
  return typeof body !== "object" || body === null || runsMutation(body);
}

/** Whether the operation `operationName` picks is a mutation, or any is when it picks none. */
function runsMutation(body: object): boolean {
  const query: unknown = Reflect.get(body, "query");
  const name: unknown = Reflect.get(body, "operationName");
  if (typeof query !== "string") return true;
  const operations = definedOperations(query.replace(IGNORED, " "));
  if (operations === undefined) return true;
  const picked = operations.filter(
    (operation) => typeof name === "string" && operation.name === name,
  );
  return (picked.length > 0 ? picked : operations).some(({ kind }) => kind === "mutation");
}

/** Operations at brace depth zero, or `undefined` when the braces don't balance and nothing is sure. */
function definedOperations(document: string): { kind: string; name?: string }[] | undefined {
  const operations: { kind: string; name?: string }[] = [];
  let depth = 0;
  for (const [token, kind, name] of document.matchAll(TOKEN)) {
    if (token === "{") depth++;
    else if (token === "}" && --depth < 0) return undefined;
    else if (depth === 0 && kind !== undefined) operations.push({ kind, name });
  }
  return depth === 0 ? operations : undefined;
}

/** Strings and comments in one pass, so a `#` in a string or a quote in a comment stays put. */
const IGNORED = /"""(?:\\"""|[\s\S])*?"""|"(?:\\.|[^"\\\n])*"|#.*/gu;

/** Braces, plus each operation keyword and the name after GraphQL's ignored separators. */
const TOKEN = /[{}]|(?<![$@\w])(query|mutation|subscription)(?!\w)[\s,\uFEFF]*([_A-Za-z]\w*)?/gu;

/** A 5xx, or a write whose answer was lost or cut, says nothing about what the forge did. */
function unsettledWrite(error: FetchError): boolean {
  if (!isWrite(error)) return false;
  if (error.status !== undefined) {
    return error.status >= 500 || (error.cause !== undefined && error.status < 400);
  }
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
    const code: unknown = Reflect.get(cause, "code");
    if (typeof code === "string" && NEVER_SENT.has(code)) return false;
    cause = cause.cause;
  }
  return true;
}

/** A copy with the hint appended, keeping the subclass and fields such as `retryAfter`. */
function withHint<E extends ForgesError>(error: E, hint: string): E {
  const hinted = Object.assign(Object.create(Object.getPrototypeOf(error) as object) as E, error);
  hinted.message = `${error.message.replace(/[\s.]+$/u, "")}. ${hint}`;
  hinted.stack = error.stack?.replace(error.message, () => hinted.message);
  return hinted;
}

/** Longest provider reason a message repeats; the rest of a longer one is cut. */
const REASON_LIMIT = 200;

/** Longest text read from one field of an error body. */
const REASON_SCAN = REASON_LIMIT * 8;

/** Items read from one list or field map of an error body. */
const REASON_ITEMS = 5;

/** The caller's address, which GitHub repeats in its rate limit text. */
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 =
  /(?<![\w:])(?:[\da-f]{1,4}:){3,7}[\da-f]{1,4}(?![\w:])|(?<![\w:])(?:[\da-f]{1,4}:)*[\da-f]{0,4}::(?:[\da-f]{1,4}(?::[\da-f]{1,4})*)?(?![\w:])/gi;
const USERINFO = /(\b[a-z][\w+.-]*:\/\/)[^\s/@]*@/gi;
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** The request message stops at the status, and the reason from the body goes after it. */
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

  const reason = [...new Set(parts)]
    .filter((part) => part !== undefined)
    .join(": ")
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .replace(USERINFO, "$1")
    .replace(IPV4, "<address>")
    .replace(IPV6, "<address>")
    .trim();
  if (!reason) return undefined;
  if (reason.length <= REASON_LIMIT) return reason;
  const end = /[\uD800-\uDBFF]/.test(reason.charAt(REASON_LIMIT - 2))
    ? REASON_LIMIT - 2
    : REASON_LIMIT - 1;
  return `${reason.slice(0, end).trimEnd()}…`;
}

/** Half an address or credential would slip past the masks, so a token the cut splits goes whole. */
function bounded(text: string): string {
  if (text.length <= REASON_SCAN) return text;
  const cut = text.slice(0, REASON_SCAN);
  return /\s/.test(text.charAt(REASON_SCAN)) ? cut : cut.replace(/\S*$/, "");
}

/** A string, a list of them, or GitLab's map from field to its errors. */
function reasonText(value: unknown): string | undefined {
  if (typeof value === "string" || Array.isArray(value)) return messages(value);
  if (typeof value !== "object" || value === null) return undefined;
  const fields: (string | undefined)[] = [];
  for (const field in value) {
    if (!Object.hasOwn(value, field)) continue;
    const text = messages((value as Record<string, unknown>)[field]);
    fields.push(text === undefined ? undefined : bounded(`${field} ${text}`));
    if (fields.length === REASON_ITEMS) break;
  }
  return joinReasons(fields);
}

function messages(value: unknown): string | undefined {
  if (typeof value === "string") return bounded(value) || undefined;
  if (!Array.isArray(value)) return undefined;
  return joinReasons(
    value
      .slice(0, REASON_ITEMS)
      .map((item) => (typeof item === "string" ? bounded(item) : undefined)),
  );
}

/** One entry of GitHub's `errors`: its own message, or the field and the code. */
function fieldError(entry: unknown): string | undefined {
  if (typeof entry === "string") return bounded(entry) || undefined;
  if (typeof entry !== "object" || entry === null) return undefined;
  const { message, field, code } = entry as Record<string, unknown>;
  if (typeof message === "string" && message) return bounded(message);
  if (typeof field === "string" && typeof code === "string") return bounded(`${field} ${code}`);
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
