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

  for (let index = 0; index <= pathnameSegments.length - apiSegments.length; index++) {
    if (apiSegments.every((segment, offset) => pathnameSegments[index + offset] === segment)) {
      return true;
    }
  }

  return false;
}
