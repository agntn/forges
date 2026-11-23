import { ForgesError } from "./errors.ts";
import { quoted } from "./issue-fields.ts";
import type { ProviderConfig } from "./types.ts";

/** Every key a provider reads, held to `ProviderConfig` by `satisfies`. */
const KNOWN_KEYS = {
  baseURL: true,
  token: true,
  username: true,
  accountId: true,
  cache: true,
  gitlab: true,
} as const satisfies Record<keyof ProviderConfig, true>;

/**
 * Refuse a key no provider reads, so `baseUrl` can't quietly mean the public host.
 *
 * @throws {ForgesError} A 400 naming the key and its near match.
 */
export function assertProviderConfig(config: ProviderConfig | undefined, platform: string): void {
  if (config === undefined || config === null) return;
  for (const key of Object.keys(config)) {
    if (Object.hasOwn(KNOWN_KEYS, key)) continue;
    const meant = Object.keys(KNOWN_KEYS).find(
      (known) => known.toLowerCase() === key.toLowerCase(),
    );
    throw new ForgesError(
      `Unknown provider config key ${quoted(key)}` +
        (meant === undefined
          ? `. Known keys: ${Object.keys(KNOWN_KEYS).join(", ")}`
          : `. Did you mean ${quoted(meant)}?`),
      { status: 400, platform },
    );
  }
}
