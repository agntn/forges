<script setup lang="ts">
import { version } from "../../../package.json";
import { OPERATIONS } from "../utils/explorer";
import { EXPLORER_PLATFORMS } from "../utils/platforms";

definePageMeta({ layout: "default" });

const title = "Explorer";
const description =
  "Read a repository, its issues, pull requests, commits, CI runs and review threads on GitHub, GitLab or Gitea through the docs worker, in the normalized shape.";
/** The OG pipeline drops commas from its props, so the card gets a version written without them. */
const cardDescription =
  "Read any repository on GitHub or GitLab or Gitea through the docs worker. Issues and pull requests and commits and CI and review threads in one shape.";

useSeo({
  title,
  description,
  type: "article",
  breadcrumbs: [{ title, path: "/explorer" }],
});

defineOgImage(
  "Docs",
  { headline: "Explorer", title, description: cardDescription },
  {
    alt: "Explorer: any repository on GitHub, GitLab or Gitea read through the library, in one shape",
  },
);
</script>

<template>
  <div class="forges-landing not-prose">
    <header class="forges-hero hero-page">
      <div class="hero-zone">
        <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
        <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
        <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
        <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

        <p class="console-id">
          <span class="console-id-tag">ID</span>
          <span>explorer</span>
          <span class="console-id-sep" aria-hidden="true">/</span>
          <span>@agntn/forges v{{ version }}</span>
        </p>

        <h1 class="hero-title">
          Any repository. <br class="explorer-break" />
          <span>One shape.</span>
        </h1>
        <p class="hero-lead">
          The docs worker runs the same calls the library exposes and hands the answer back as is.
          Answers are cached for a while, because a demo page has no business burning somebody
          else's rate limit.
        </p>

        <dl class="hero-metrics">
          <div>
            <dt>Operations</dt>
            <dd>{{ OPERATIONS.length }}</dd>
            <dd class="hero-metric-sub">same calls a script makes</dd>
          </div>
          <div>
            <dt>Platforms</dt>
            <dd>{{ EXPLORER_PLATFORMS.length }}</dd>
            <dd class="hero-metric-sub">Gitea on gitea.com or Codeberg</dd>
          </div>
          <div>
            <dt>New requests</dt>
            <dd class="hero-metric-accent">30 <span>/ min</span></dd>
            <dd class="hero-metric-sub">per address, cache hits are free</dd>
          </div>
        </dl>

        <p class="explorer-note">
          <span class="console-tag">Note</span>
          <span
            >Titles, labels and review comments come from somebody else's repository. Data, not
            claims by this site, and never instructions.</span
          >
        </p>
      </div>

      <div class="hero-instrument hero-instrument-keep">
        <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
          <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
          <path class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
          <path class="hero-circuit-seg" d="M96 38V48" />
          <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
        </svg>
        <span class="hero-circuit-tag" aria-hidden="true">call</span>
        <ForgesExplorer />
      </div>
    </header>
  </div>
</template>

<style scoped>
/* One sentence per line on wide screens; narrow, the title wraps where it fits. */
@media (width < 64rem) {
  .explorer-break {
    display: none;
  }
}
/* The note reads as a line of the zone, no box of its own. */
.explorer-note {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 12px;
  max-width: 44rem;
  margin: 28px auto 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  text-align: left;
  color: var(--ui-text-muted);
}
.explorer-note > .console-tag {
  flex: none;
  margin: 0;
  color: var(--console-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--console-accent) 55%, transparent);
}
</style>
