/**
 * Opaque page cursors for every listing.
 *
 * A cursor is base64url JSON naming the listing it came from and one way to
 * continue it: a page number, a next-page URL or a forge-native token. The
 * listing tag keeps a cursor from one listing out of another, and a URL must
 * stay on the provider's own origin, so a cursor written by hand cannot send
 * a request anywhere else.
 */

import { ForgesError } from "./errors.ts";

/** Where the next page starts: a page number, a next-page URL, or a forge-native token. */
export type PagePosition = { page: number } | { url: string } | { token: string };

interface CursorBody {
  /** Listing the cursor belongs to. */
  k: string;
  p?: number;
  u?: string;
  t?: string;
}

/** Turns a position in `listing` into the string a caller passes back as `cursor`. */
export function encodeCursor(listing: string, position: PagePosition): string {
  const body: CursorBody =
    "page" in position
      ? { k: listing, p: position.page }
      : "url" in position
        ? { k: listing, u: position.url }
        : { k: listing, t: position.token };
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/** Reads a cursor back; a URL must keep `origin`, and anything else is a 400 naming the listing. */
export function decodeCursor(
  cursor: string,
  listing: string,
  origin: string | undefined,
  platform?: string,
): PagePosition {
  const refuse = (): never => {
    throw new ForgesError(
      `cursor is not one that ${listing} returned; pass back nextCursor unchanged`,
      400,
      platform,
    );
  };
  if (!/^[\w-]{1,2048}$/u.test(cursor)) return refuse();
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return refuse();
  }
  if (typeof body !== "object" || body === null) return refuse();
  const { k, p, u, t } = body as Partial<Record<keyof CursorBody, unknown>>;
  if (k !== listing) return refuse();
  if (typeof p === "number" && Number.isSafeInteger(p) && p >= 2) return { page: p };
  if (typeof t === "string" && t !== "") return { token: t };
  if (typeof u === "string" && origin !== undefined && sameOrigin(u, origin)) return { url: u };
  return refuse();
}

function sameOrigin(url: string, origin: string): boolean {
  const target = URL.parse(url);
  const base = URL.parse(origin);
  return (
    target !== null &&
    base !== null &&
    target.origin === base.origin &&
    (target.protocol === "https:" || target.protocol === "http:") &&
    target.username === "" &&
    target.password === ""
  );
}
