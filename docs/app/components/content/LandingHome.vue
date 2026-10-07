<script setup lang="ts">
import { AGENT_TOOLS, WRITE_TOOLS } from "../../utils/tools";
import { spellOut } from "../../utils/format";
import { PLATFORMS, PROVIDER_PLATFORMS } from "../../utils/platforms";

/** Counted from the platform table, so the next provider can't leave the heading behind. */
const providersHeading =
  `${spellOut(PROVIDER_PLATFORMS.length)} providers, ${spellOut(PLATFORMS.length)} platforms`.replace(
    /^./u,
    (letter) => letter.toUpperCase(),
  );

const { samples, paused, current, step } = useLandingForge();
</script>

<template>
  <div class="forges-landing not-prose">
    <LandingHero :sample="current" :samples="samples" @step="step" @pause="paused = $event" />

    <LandingFeature
      title="Token found for you"
      to="/guide/auth"
      link="Authentication"
      :checks="[
        'An explicit token wins, and an empty string is a real choice: read anonymously',
        'Nothing found throws right away, naming the env vars it tried',
        'The CLI goes through execFileSync with an argument array. No shell in between',
      ]"
    >
      <code class="forges-code">createProvider("github")</code> reads the token from env, then asks
      <code class="forges-code">gh</code>, then opens its config file. GitLab asks
      <code class="forges-code">glab</code>, Gitea reads the <code class="forges-code">tea</code>
      config. You write the platform name and nothing else. The panel walks the same
      {{ samples.length }} repositories as everything below it.
      <template #visual>
        <LandingToken :sample="current" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="Merge requests are pull requests here"
      to="/guide/pull-requests"
      link="Issues and pull requests"
      :checks="[
        'GitLab iid becomes number, and GitHub issues that are really PRs are filtered out',
        'list, search, get, create and listComments with the same options everywhere',
        'PageResult with items, hasNextPage and nextPage, whether the platform sent Link or x-next-page',
      ]"
      reverse
    >
      Every platform paginates its own way and names things its own way, and none of it is your
      problem. A page is <code class="forges-code">{ items, hasNextPage, nextPage }</code>, a state
      is <code class="forges-code">open</code> or <code class="forges-code">closed</code>, and a
      pull request knows its branches, its head SHA and whether it's still a draft.
      <template #visual>
        <LandingPulls :sample="current" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="History and pipelines, normalized"
      to="/guide/commits"
      link="Commits, CI runs and checks"
      :checks="[
        'commits.list filters by ref, path, since and until; get adds changed files without patches',
        'ciRuns.list turns Actions runs, GitLab pipelines and Gitea Actions into one status and one conclusion',
        'pullRequests.listChecks reads check runs, GitLab pipelines or commit statuses for the head SHA',
      ]"
    >
      A commit is a SHA, a message, two identities and its parents. A CI run is a branch, a
      revision, a lifecycle status and a conclusion that stays
      <code class="forges-code">null</code> until there is one. Counts a platform withholds come
      back as <code class="forges-code">null</code> too. Never as zero, zero would be a lie.
      <template #visual>
        <LandingHistory :sample="current" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="Reply, resolve, unresolve"
      to="/guide/threads"
      link="Review threads"
      :checks="[
        'GitHub threads go through GraphQL, so isResolved and isOutdated are real, not guessed',
        'GitLab discussions and Gitea review comments land on the same Thread',
        'GitBucket has no thread endpoint and says so in a sentence, not a bare 404',
      ]"
      reverse
    >
      A review thread is a path, a line and its comments, with a state you can flip. The id
      <code class="forges-code">list</code> gives you is the id
      <code class="forges-code">reply</code> and <code class="forges-code">resolve</code> take back,
      whatever the platform calls it underneath.
      <template #visual>
        <LandingThreads :sample="current" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <section class="forges-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <div class="max-w-2xl">
          <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-[1.75rem]">
            {{ providersHeading }}
          </h2>
          <p class="mt-4 text-sm leading-6 text-muted">
            GitHub wants <code class="forges-code">Authorization: token</code>, GitLab wants
            <code class="forges-code">Private-Token</code>, Gitea wants
            <code class="forges-code">limit</code> instead of
            <code class="forges-code">per_page</code>. Each provider keeps that to itself and maps
            its raw responses onto the shared types. GitBucket speaks the GitHub API, so it's the
            GitHub provider with a <code class="forges-code">baseURL</code>. Forgejo and Codeberg
            are Gitea the same way. Cloudflare Artifacts gets a class of its own: plain Git storage
            with a Bearer token and no forge on top. And your own forge is one class away.
          </p>
          <p class="landing-entry">
            <span class="console-tag">Import</span>
            <code>import { GitLabProvider } from "@agntn/forges/gitlab"</code>
          </p>
        </div>
        <LandingPlatforms :sample="current" class="mt-10" @pause="paused = $event" />
      </div>
    </section>

    <LandingFeature
      :title="`${AGENT_TOOLS} tools, three hosts`"
      to="/guide/agents"
      link="MCP, Pi and OMP"
      :checks="[
        'Reads fall back to anonymous access, writes and forges_users_authenticated need a credential',
        'Lists drop bodies and name the tool that reads one in full, so a busy page still fits in a context',
        'A self hosted FORGES_*_BASE_URL comes from the process environment, never from a tool argument',
      ]"
      reverse
    >
      <code class="forges-code">forges mcp</code> serves the tools over stdio, the Pi and OMP
      extensions render them in the terminal. All three call the same executors, so they answer
      identically and a fix lands once. {{ WRITE_TOOLS }} tools write, and they say so in their
      annotations, so a client can gate them before a model gets creative.
      <template #visual>
        <LandingToolCall :sample="current" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="Same calls, every provider"
      to="/guide"
      link="Getting started"
      :checks="[
        'repos, contributionTemplates, code, ciRuns, commits, releases, issues, pullRequests, users, threads',
        'NotFoundError, AuthenticationError, PermissionError, RateLimitError with retryAfter',
        'Stable reads cached with an LRU keyed by host and token hash, item reads always fresh',
      ]"
    >
      <code class="forges-code">Provider</code> is the abstract base with the ten resource
      accessors. Concrete classes implement the typed mappers and the platform calls, nothing else
      leaks upward. Sub path imports give you one provider without dragging in the other two.
      <template #visual>
        <LandingRotatingCode :sample="current" @step="step" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <section class="forges-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <LandingStart />
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing-entry {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 20px 0 0;
  min-width: 0;
}
.landing-entry > .console-tag {
  flex: none;
  margin: 0;
}
.landing-entry > code {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
</style>
