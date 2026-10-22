import { ForgesError } from "../errors.ts";

/**
 * Encode an API identifier as exactly one URL path segment.
 *
 * @param field - Names the argument in the refusal, so the caller knows which value to fix.
 * @throws {ForgesError} A 400 when a numeric identifier is not a positive safe integer,
 * or when a string identifier is empty, a dot segment, contains a path
 * separator or control character, or is already percent-encoded.
 */
export function encodePathSegment(value: string | number, field = "Identifier"): string {
  const segment = String(value);
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 1)) {
    throw new ForgesError(`${field} must be a positive integer`, { status: 400 });
  }
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("%") ||
    /* oxlint-disable-next-line no-control-regex */
    /[\u0000-\u001F\u007F]/.test(segment)
  ) {
    throw new ForgesError(
      `${field} must be one path segment: not empty, "." or "..", and without "/", "\\", "%" or control characters`,
      { status: 400 },
    );
  }

  return encodeURIComponent(segment);
}

/**
 * Encode a raw path segment returned by a forge API. A literal percent sign is
 * allowed and encoded again rather than interpreted as an existing escape.
 */
export function encodeApiResponsePathSegment(value: string): string {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    /* oxlint-disable-next-line no-control-regex */
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new TypeError("Invalid API response path segment");
  }

  return encodeURIComponent(value);
}

/**
 * Encode a label name as one URL path segment. Names such as `kind/bug` or
 * `100%` are ordinary labels, so every character is percent-encoded instead of
 * refused. A dot segment is refused: URL parsing collapses it even encoded.
 */
export function encodeLabelPathSegment(name: string): string {
  if (name.length === 0 || name === "." || name === "..") {
    throw new ForgesError('Label name must not be empty, "." or ".."', { status: 400 });
  }

  return encodeURIComponent(name);
}

/**
 * What `git check-ref-format` refuses: control characters, space, `~ ^ : ? * [ \`,
 * `..`, `@{`, a leading or trailing or doubled `/`, a trailing `.`, a component
 * starting with `.` or ending in `.lock`.
 */
const INVALID_REF_NAME =
  /* oxlint-disable-next-line no-control-regex */
  /[\u0000-\u0020\u007F~^:?*[\\]|\.\.|@\{|^\/|\/$|\/\/|\.$|(?:^|\/)\.|\.lock(?:$|\/)/;

/**
 * Encode a git ref name as one URL path segment. A tag may carry `/` or `%`,
 * so both are percent-encoded instead of refused; a name git itself would not
 * accept as a ref is refused before any request goes out.
 */
export function encodeRefPathSegment(value: string, field = "Ref"): string {
  if (value.length === 0 || INVALID_REF_NAME.test(value)) {
    throw new ForgesError(`${field} must be a ref name git accepts`, { status: 400 });
  }

  return encodeURIComponent(value);
}

/** A ref name with optional `~N` and `^N` steps, such as `main~2`. Tags take a bare ref name. */
export function encodeRevisionPathSegment(value: string, field = "Revision"): string {
  let nameEnd = value.length;
  while (nameEnd > 0) {
    let stepStart = nameEnd;
    while (stepStart > 0 && /\d/.test(value[stepStart - 1] ?? "")) stepStart -= 1;
    const step = value[stepStart - 1];
    if (step !== "~" && step !== "^") break;
    nameEnd = stepStart - 1;
  }

  const name = value.slice(0, nameEnd);
  if (name.length === 0 || INVALID_REF_NAME.test(name)) {
    throw new ForgesError(
      `${field} must be a ref name git accepts, optionally with ~N or ^N steps`,
      { status: 400 },
    );
  }

  return encodeURIComponent(value);
}

export function normalizeApiBaseURL(
  baseURL: string | undefined,
  { fallbackBaseURL, apiPath }: Readonly<{ fallbackBaseURL: string; apiPath: string }>,
): string {
  if (!baseURL) {
    return fallbackBaseURL;
  }

  try {
    const url = new URL(baseURL);
    const pathname = url.pathname.replace(/\/+$/, "");
    const normalizedApiPath = apiPath.replace(/\/+$/, "");
    const pathnameSegments = pathname.split("/").filter(Boolean);
    const apiSegments = normalizedApiPath.split("/").filter(Boolean);

    if (hasPathSegments(pathnameSegments, apiSegments)) {
      return url.toString();
    }

    url.pathname = pathname ? `${pathname}${normalizedApiPath}` : normalizedApiPath;

    return url.toString();
  } catch {
    return baseURL;
  }
}

function hasPathSegments(pathnameSegments: string[], apiSegments: string[]): boolean {
  if (apiSegments.length === 0 || pathnameSegments.length < apiSegments.length) {
    return false;
  }

  const startIndex = pathnameSegments.length - apiSegments.length;
  return apiSegments.every((segment, offset) => pathnameSegments[startIndex + offset] === segment);
}
