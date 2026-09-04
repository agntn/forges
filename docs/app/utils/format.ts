/** `2024-01-20T14:25:10.000Z` → `2024-01-20`. */
export function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Cuts a text at `max` code points with an ellipsis. */
export function clip(value: string, max: number): string {
  const points = [...value];
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : value;
}

/** The first line of a commit message or a body, for a one-line row. */
export function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
}

/** A short SHA, seven characters like git itself. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Host and path for display, without the scheme or the query: `github.com/unjs/nitro`. */
export function hostPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname.replace(/\/$/u, "")}`;
  } catch {
    return url;
  }
}

/** Strips markup from text that came from someone else's tracker. The page shows text, never markup. */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `owner/repo` split into its two parts, or null when the input is not that shape. */
export function splitSlug(value: string): { owner: string; repo: string } | null {
  const match = /^\s*([\w.-]+)\/([\w.-]+)\s*$/u.exec(value);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}
