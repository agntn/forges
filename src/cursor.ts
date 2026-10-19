/**
 * Opaque page cursors for every listing.
 *
 * A cursor is base64url JSON naming the listing it came from and one way to
 * continue it: a page number, a next-page URL or a forge-native token. The
 * listing tag keeps a cursor from one listing out of another, and a URL must
 * stay on the provider's own origin, so a cursor written by hand cannot send
 * a request anywhere else.
 */

import { Buffer } from "node:buffer";
import { hmac } from "@agntn/hashes/hmac";
import { Sha256Hasher, sha256 } from "@agntn/hashes/sha2";

import { ForgesError } from "./errors.ts";

/** Room for any next-page URL a forge serves; a server refuses longer request lines first. */
const MAX_CURSOR_LENGTH = 32_768;

/** Where the next page starts: a page number, a next-page URL, or a forge-native token. */
export type PagePosition = { page: number } | { url: string } | { token: string };

interface CursorBody {
  /** Listing the cursor belongs to. */
  k: string;
  /** Digest of the request it continues: who, where and which filters. */
  s: string;
  /** MAC over the rest under the provider's key, so a URL can't be written by hand. */
  m?: string;
  p?: number;
  u?: string;
  t?: string;
}

/** A short digest of the request a listing answered, so its cursor fits no other request. */
export function cursorScope(subject: readonly unknown[]): string {
  return Buffer.from(sha256(Buffer.from(canonical(subject)))).toString("base64url", 0, 12);
}

/** JSON with object keys sorted, so the same filters always give the same digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Turns a position in `listing` into the string a caller passes back as `cursor`. */
export function encodeCursor(
  listing: string,
  position: PagePosition,
  scope = "",
  key?: Uint8Array,
): string {
  const body: CursorBody =
    "page" in position
      ? { k: listing, s: scope, p: position.page }
      : "url" in position
        ? { k: listing, s: scope, u: position.url }
        : { k: listing, s: scope, t: position.token };
  if (key !== undefined && "url" in position) body.m = mac(key, body);
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/** The first 16 bytes of HMAC-SHA256 over the cursor body without its MAC. */
function mac(key: Uint8Array, body: CursorBody): string {
  const { m: _m, ...unsigned } = body;
  const digest = hmac(() => new Sha256Hasher(), key, Buffer.from(JSON.stringify(unsigned)));
  return Buffer.from(digest).toString("base64url", 0, 16);
}

/** Compares two MACs in time that doesn't depend on where they differ. */
function sameMac(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** Reads a cursor back; a URL must keep `origin`, and anything else is a 400 naming the listing. */
export function decodeCursor(
  cursor: string,
  listing: string,
  origin: string | undefined,
  platform?: string,
  scope = "",
  key?: Uint8Array,
): PagePosition {
  const refuse = (): never => {
    throw new ForgesError(
      `cursor is not one that ${listing} returned; pass back nextCursor unchanged`,
      400,
      platform,
    );
  };
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[\w-]+$/u.test(cursor)) return refuse();
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return refuse();
  }
  if (typeof body !== "object" || body === null) return refuse();
  const { k, s, m, p, u, t } = body as Partial<Record<keyof CursorBody, unknown>>;
  if (k !== listing || (s ?? "") !== scope) return refuse();
  if (key !== undefined && u !== undefined) {
    const unsigned = { ...(body as CursorBody), m: undefined };
    if (typeof m !== "string" || !sameMac(m, mac(key, unsigned))) return refuse();
  }
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
