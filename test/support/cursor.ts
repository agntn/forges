import { cursorScope, encodeCursor } from "../../src/cursor.ts";

/** The cursor a numbered listing hands out for `page` of one request. */
export function cursorFor(
  listing: string,
  page: number,
  subject: readonly unknown[] = [],
  filters: Record<string, unknown> = {},
): string {
  return encodeCursor(listing, { page }, cursorScope([...subject, filters]));
}
