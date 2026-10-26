import { Buffer } from "node:buffer";
import { sha256 } from "@agntn/hashes/sha2";
import { ForgesError } from "./errors.ts";
import { readTextWindow, textWindowEnd, type TextWindow } from "./text-window.ts";

const BODY_HASH = /^[0-9a-f]{16}$/u;

/** How much of a body one tool read returns, and the fingerprint of the read it continues. */
export interface BodyWindowOptions {
  offset?: number;
  maxChars?: number;
  hash?: string;
}

/** What a refusal names, and the field the body fingerprint rides in. */
export interface BodySubject {
  subject: string;
  noun: string;
  hashName: string;
  platform?: string;
}

/** One slice of a body with everything needed to ask for the next. */
export interface BodyWindow {
  body: string;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  /** Length of the whole body, so an agent knows how many reads are left before it starts. */
  length: number;
  /** Fingerprint of the whole body. Handing it back stops an edit splicing two versions. */
  hash: string;
}

/** Validate the window before provider I/O. */
export function assertBodyWindow(options: BodyWindowOptions, about: BodySubject): TextWindow {
  const { subject, hashName, platform } = about;
  const window = readTextWindow(options, { subject, platform });
  if (options.hash !== undefined && !BODY_HASH.test(options.hash)) {
    throw new ForgesError(
      `${subject} ${hashName} must be the 16 hex digits a previous read returned`,
      {
        status: 400,
        platform,
      },
    );
  }
  if (window.offset > 0 && options.hash === undefined) {
    throw new ForgesError(`${subject} offset needs the ${hashName} of the read it continues`, {
      status: 400,
      platform,
    });
  }
  return window;
}

/** First 8 bytes of the body's SHA-256 in hex, plenty to notice an edit between two reads. */
export function hashBody(body: string): string {
  return Buffer.from(sha256(new TextEncoder().encode(body))).toString("hex", 0, 8);
}

/** Cut one slice of `body`, refusing a continuation whose fingerprint no longer matches. */
export function sliceBody(
  body: string,
  options: BodyWindowOptions & { about: BodySubject },
): BodyWindow {
  const { about } = options;
  const { subject, noun, hashName, platform } = about;
  const window = assertBodyWindow(options, about);
  const hash = hashBody(body);
  if (options.hash !== undefined && options.hash !== hash) {
    throw new ForgesError(
      `${subject} changed since the read that returned this ${hashName}. Read again from offset 0`,
      { status: 409, platform },
    );
  }
  const { length } = body;
  const { end, nextOffset, truncated } = textWindowEnd(window, {
    length,
    pastEnd: `${subject} offset is past the end of the ${noun}`,
    platform,
  });
  return {
    body: body.slice(window.offset, end),
    offset: window.offset,
    nextOffset,
    truncated,
    length,
    hash,
  };
}

/** How much of an issue or pull-request body one tool read returns. */
export interface ItemBodyOptions {
  offset?: number;
  maxChars?: number;
  bodyHash?: string;
}

/** An issue or pull request with one slice of its body. Same number plus nextOffset reads on. */
export type ItemBodySlice<T> = T & Omit<BodyWindow, "hash"> & { bodyHash: string };

/** The refusal subject for an issue or pull-request body window. */
export function itemBody(subject: string, platform?: string): BodySubject {
  return { subject, noun: "body", hashName: "bodyHash", platform };
}

/** Validate an issue or pull-request body window before provider I/O. */
export function assertItemBodyOptions(options: ItemBodyOptions, about: BodySubject): TextWindow {
  const { offset, maxChars, bodyHash } = options;
  return assertBodyWindow({ offset, maxChars, hash: bodyHash }, about);
}

/** Cut one slice of an item's body. Everything else about the item rides along untouched. */
export function sliceItemBody<T extends { body: string }>(
  item: T,
  options: ItemBodyOptions & { about: BodySubject },
): ItemBodySlice<T> {
  const { offset, maxChars, bodyHash, about } = options;
  const { hash, ...window } = sliceBody(item.body, { offset, maxChars, hash: bodyHash, about });
  return { ...item, ...window, bodyHash: hash };
}
