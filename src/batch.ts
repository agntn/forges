/** Most keys one call takes, the cap agntn/web uses too. */
export const MAX_BATCH_ITEMS = 10;

/** One key of a batch with its result or its error. */
export type BatchItem<Name extends string, Key, T> =
  | (Record<Name, Key> & { result: T })
  | (Record<Name, Key> & { error: string });
