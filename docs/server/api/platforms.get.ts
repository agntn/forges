import { version } from "../../../package.json";

export interface PlatformsAnswer {
  version: string;
  /** Per platform: whether the worker holds a token and which host it talks to. Never a token. */
  platforms: ReturnType<typeof platformStatus>[];
}

/** The platforms as the worker sees them; `authenticated` says whether the worker holds a token, nothing more. */
export default defineEventHandler((event): PlatformsAnswer => {
  markPublic(event, TTL.platforms);
  return { version, platforms: PLATFORMS.map(platformStatus) };
});
