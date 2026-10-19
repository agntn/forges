import { cursorScope, encodeCursor } from "../../src/cursor.ts";

/** A page of one request: its path arguments and its filters. */
export interface CursorPage {
  page: number;
  subject?: readonly unknown[];
  filters?: Record<string, unknown>;
}

/** The cursor a numbered listing hands out for `page` of one request. */
export function cursorFor(listing: string, request: CursorPage): string {
  const { page, subject = [], filters = {} } = request;
  return encodeCursor({ page }, { listing, scope: cursorScope([...subject, filters]) });
}
