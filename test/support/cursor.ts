import { encodeCursor } from "../../src/cursor.ts";

/** The cursor a numbered listing hands out for `page`. */
export function cursorFor(listing: string, page: number): string {
  return encodeCursor(listing, { page });
}
