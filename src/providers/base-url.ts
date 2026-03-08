export function normalizeApiBaseURL(
  baseURL: string | undefined,
  fallbackBaseURL: string,
  apiPath: string
): string {
  if (!baseURL) {
    return fallbackBaseURL;
  }

  try {
    const url = new URL(baseURL);
    const pathname = url.pathname.replace(/\/+$/, '');
    const normalizedApiPath = apiPath.replace(/\/+$/, '');
    const pathnameSegments = pathname.split('/').filter(Boolean);
    const apiSegments = normalizedApiPath.split('/').filter(Boolean);

    if (hasPathSegments(pathnameSegments, apiSegments)) {
      return url.toString();
    }

    url.pathname = pathname
      ? `${pathname}${normalizedApiPath}`
      : normalizedApiPath;

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
  return apiSegments.every(
    (segment, offset) => pathnameSegments[startIndex + offset] === segment
  );
}
