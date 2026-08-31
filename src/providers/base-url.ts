/**
 * Encode an API identifier as exactly one URL path segment.
 *
 * @throws {TypeError} When a numeric identifier is not a positive safe integer,
 * or when a string identifier is empty, a dot segment, contains a path
 * separator or control character, or is already percent-encoded.
 */
export function encodePathSegment(value: string | number): string {
  const segment = String(value);
  if (
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 1)) ||
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("%") ||
    /* oxlint-disable-next-line no-control-regex */
    /[\u0000-\u001F\u007F]/.test(segment)
  ) {
    throw new TypeError("Invalid API path segment");
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

export function normalizeApiBaseURL(
  baseURL: string | undefined,
  fallbackBaseURL: string,
  apiPath: string,
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
