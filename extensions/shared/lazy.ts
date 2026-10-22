/**
 * Memoize an async load so it runs once per process.
 *
 * The pending promise is shared, so concurrent first calls trigger one load. A
 * rejection clears it, which lets the next call retry instead of replaying the
 * same failure forever.
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= (async () => load())().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** Loads take turns: Pi's uncached jiti gives a module still evaluating to the next importer. */
export function oneAtATime(): <T>(load: () => Promise<T>) => () => Promise<T> {
  let previous: Promise<unknown> = Promise.resolve();
  return (load) => () => {
    const next = previous.then(load);
    previous = next.catch(() => undefined);
    return next;
  };
}
