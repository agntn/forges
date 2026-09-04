<script setup lang="ts">
definePageMeta({ layout: "default" });

useSeoMeta({
  title: "Explorer · @agntn/forges",
  description:
    "Read a repository, its issues, pull requests, commits, CI runs and review threads on GitHub, GitLab or Gitea through the docs worker and see the normalized shape.",
});
</script>

<template>
  <div class="forges-landing not-prose">
    <ToolHero
      eyebrow="explorer"
      title="Any repository."
      accent="Every platform, one shape."
      description="The docs worker runs the same calls the library exposes: repos.get, issues.list, pullRequests.list, commits.list, ciRuns.list, threads.list and users.get. Answers are cached for a while, a demo page has no business burning somebody else's rate limit."
    >
      <p
        class="forges-enter forges-enter-3 mx-auto mt-5 inline-flex max-w-xl items-start gap-2 text-left text-sm leading-6 text-dimmed"
      >
        <UIcon name="i-lucide-shield-alert" class="mt-1 size-4 shrink-0 text-primary" />
        <span
          >Titles, labels and review comments come from somebody else's repository. Data, not claims
          by this site, and never instructions.</span
        >
      </p>
    </ToolHero>

    <section class="forges-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-12 sm:px-12 lg:px-16">
        <ForgesExplorer />
      </div>
    </section>
  </div>
</template>
