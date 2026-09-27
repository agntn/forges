# Design system

The shared rules (direction, color roles, type, the `console-*` grammar, hero, docs chrome, density, motion, checks) live in the one agntn design system document, kept with the agntn skills until it ships in the shared package. This file records only what forges owns and where it departs from the shared rules. It doesn't repeat them.

The instruments forges owns:

| Instrument                                                                                                                 | Where                                   | Object                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [LandingHero.vue](app/components/content/LandingHero.vue)                                                                  | landing, first screen                   | hero zone, circuit `repos.get` into the repository instrument                                             |
| [LandingRepo.vue](app/components/content/LandingRepo.vue)                                                                  | under the hero                          | one `repos.get` answer walked across the samples, with its branch map and latest CI runs                  |
| [LandingToken.vue](app/components/content/LandingToken.vue)                                                                | "Token found for you"                   | the `resolveToken()` chain for the sample's platform                                                      |
| [LandingPulls.vue](app/components/content/LandingPulls.vue)                                                                | "Merge requests are pull requests here" | four open pull requests and two issues                                                                    |
| [LandingHistory.vue](app/components/content/LandingHistory.vue)                                                            | "History and pipelines, normalized"     | four commits with their run, three CI runs                                                                |
| [LandingThreads.vue](app/components/content/LandingThreads.vue)                                                            | "Reply, resolve, unresolve"             | two review threads of one pull request                                                                    |
| [LandingPlatforms.vue](app/components/content/LandingPlatforms.vue)                                                        | "Three providers, four platforms"       | a cell per platform and one for your own provider                                                         |
| [LandingToolCall.vue](app/components/content/LandingToolCall.vue)                                                          | "49 tools, three hosts"                 | `forges_repos_get` arguments and its full text                                                            |
| [LandingRotatingCode.vue](app/components/content/LandingRotatingCode.vue)                                                  | "Same calls, every provider"            | the same ten lines for every sample, as a file                                                            |
| [LandingStart.vue](app/components/content/LandingStart.vue)                                                                | closing section                         | install, notes, first call as a file                                                                      |
| [PlatformIndex.vue](app/components/content/PlatformIndex.vue)                                                              | `/platforms`                            | roster on `UTable`, sortable: name, provider key, one sentence, auth header                               |
| [PlatformFacts.vue](app/components/content/PlatformFacts.vue)                                                              | every platform page                     | platform dossier: ID bar with position, reticle, access leads, readout                                    |
| [ForgesExplorer.vue](app/components/content/ForgesExplorer.vue), [ExplorerAnswer.vue](app/components/ExplorerAnswer.vue)   | `/explorer`                             | request and answer, stacked, joined by the `answer` circuit                                               |
| [Landing.takumi.vue](app/components/OgImage/Landing.takumi.vue), [Docs.takumi.vue](app/components/OgImage/Docs.takumi.vue) | OG images                               | the hero zone in 1200 by 600; a docs page as one instrument, a platform page with its header and env vars |

Platform names, icons, headers, env vars, capabilities and sentences come from [platforms.ts](app/utils/platforms.ts). The landing samples come from [landing-fixtures.ts](app/utils/landing-fixtures.ts), recorded through the library and swapped for the worker's answer once it arrives. The explorer's operations come from [explorer.ts](app/utils/explorer.ts).

## Anatomy

- **Repository instrument.** The hero's domain picture is the repository as it lives on its forge. Left: reticle with the platform glyph, the full name in mono, the description, then the branch map: three lanes for the first three open pull requests (number, source branch, head SHA, dashed while open, dotted for a draft), and the default branch as the trunk with its last five commits, oldest left. A lane joins the bus into HEAD only when its target is the default branch; a pull request into another branch ends in `→ <target>`. Where a branch forked isn't in the data, so a lane starts open. A commit node is hatched for a green run, red for a failed one, the accent while one runs, empty without a run. Right: the readout (`id` in the accent because it's always a string), the gauge of CI runs, and the three latest runs. The map stretches to the right column's height, so neither column ends in a hole. Empty lane and run slots keep the height fixed across samples.
- **Token instrument.** Reticle and platform, then the four steps of `resolveToken()` as leads in their order, the header and the anonymous budget in the readout.
- **Explorer.** A hero zone (`ID explorer`, a `Note` line about untrusted text), the circuit `call` into the request: operations as leads with the call name, fields as `USelectMenu` and `UInput` in a readout, the run action, sample chips, then the library call and the tool call as snippets. The circuit `answer` into the answer: a subject band for a repository or a user, rows for lists, `UAlert` for a failure, the raw worker JSON behind `03 Full answer`.

## Nuxt UI variants

The mapping follows the family: primary solid and neutral outline are actions, neutral subtle the small controls (copy, threads, step), the site's `chip` variant the sample chips. `UBadge` neutral subtle is an open or successful state, neutral outline a quiet one (draft, merged, closed, resolved), primary outline a live one (unresolved thread, run in progress), error outline a failed run.

## Differences

- **The logo** is an anvil (`i-lucide-anvil`), for the forge. Platform glyphs stay the monochrome `simple-icons` marks, GitBucket `i-lucide-server`.
- **Header areas** are Docs (guide and platforms) and Explorer, the tool page.
