import type { MergeMethod, RepositoryMergeSettings } from "./types.ts";

const MERGE_METHODS: readonly MergeMethod[] = ["merge", "squash", "rebase"];

/** One flag per method. Anything but a boolean means the platform held it back. */
type MergeMethodFlags = Readonly<Record<MergeMethod, boolean | null | undefined>>;

/** Null when a flag is missing. A default the repository no longer allows is dropped. */
export function mergeSettings(
  flags: MergeMethodFlags,
  details: Readonly<Omit<RepositoryMergeSettings, "methods">>,
): RepositoryMergeSettings | null {
  if (MERGE_METHODS.some((method) => typeof flags[method] !== "boolean")) return null;
  const methods = MERGE_METHODS.filter((method) => flags[method] === true);
  const { defaultMethod } = details;
  return {
    methods,
    defaultMethod: defaultMethod !== null && methods.includes(defaultMethod) ? defaultMethod : null,
    squashTitle: details.squashTitle,
    squashMessage: details.squashMessage,
    deleteBranchOnMerge: details.deleteBranchOnMerge,
  };
}

/** A platform's merge style as a shared method, or null for one with no counterpart. */
export function knownMergeMethod(value: unknown): MergeMethod | null {
  return MERGE_METHODS.find((method) => method === value) ?? null;
}
