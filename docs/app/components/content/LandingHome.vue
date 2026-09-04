<script setup lang="ts">
import { PLATFORMS } from "../../utils/platforms";

const { samples, tick, paused, current, step } = useLandingForge();

const stats = [
  { value: "4", label: "platforms" },
  { value: "9", label: "resources" },
  { value: "30", label: "agent tools" },
  { value: "3", label: "agent surfaces" },
] as const;

const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText("pnpm add @agntn/forges");
  } catch {
    return;
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1200);
}

/** The platform grid highlights whichever platform the panels are showing. */
const activePlatform = computed(() => current.value.platform);
</script>

<template>
  <div class="forges-landing not-prose">
    <header
      class="forges-hero mx-auto w-full max-w-[var(--ui-container)] px-8 pt-24 pb-20 text-center sm:px-12 lg:px-16"
    >
      <h1
        class="forges-enter mx-auto max-w-3xl text-4xl leading-[1.08] font-medium tracking-tight text-highlighted sm:text-5xl lg:text-[3.75rem]"
      >
        One API. <span class="text-primary">Every forge.</span>
      </h1>
      <p class="forges-enter forges-enter-2 mx-auto mt-6 max-w-xl text-base leading-7 text-muted">
        GitHub, GitLab, Gitea and GitBucket behind one TypeScript provider. Repositories, issues,
        pull requests, review threads, commits and CI, same shape everywhere, token found for you.
        Use it as a library, an MCP server or a Pi and OMP extension, your pick.
      </p>
      <div
        class="forges-enter forges-enter-3 mt-8 flex flex-wrap items-center justify-center gap-2"
      >
        <UButton to="/guide" color="primary" trailing-icon="i-lucide-arrow-right">
          Get started
        </UButton>
        <UButton
          to="https://github.com/agntn/forges"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
        >
          Star on GitHub
        </UButton>
      </div>
      <button
        type="button"
        class="forges-enter forges-enter-4 forges-install mt-5"
        :aria-label="copied ? 'Copied' : 'Copy install command'"
        @click="copyInstall"
      >
        <span class="text-dimmed">$</span>
        <span>pnpm add @agntn/forges</span>
        <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5 text-dimmed" />
      </button>

      <div
        class="forges-enter forges-enter-4 mx-auto mt-16 hidden max-w-6xl md:block"
        @mouseenter="paused = true"
        @mouseleave="paused = false"
      >
        <LandingFlow :sample="current" :tick="tick" />
      </div>
    </header>

    <dl class="forges-section grid grid-cols-2 sm:grid-cols-4">
      <div
        v-for="(stat, i) in stats"
        :key="stat.label"
        class="border-default px-6 py-7 text-center"
        :class="{ 'border-t sm:border-t-0': i >= 2, 'border-l': i % 2 === 1, 'sm:border-l': i > 0 }"
      >
        <dd class="font-mono text-2xl text-highlighted">{{ stat.value }}</dd>
        <dt class="mt-1 font-mono text-[11px] tracking-[0.12em] text-dimmed uppercase">
          {{ stat.label }}
        </dt>
      </div>
    </dl>

    <LandingFeature
      eyebrow="Repositories"
      title="Owner and name in, one Repository out"
      to="/explorer"
      link="Open the explorer"
      :checks="[
        'id is always a string, even when the platform sends a number',
        'isFork with the immediate parent, and your highest role when the platform bothers to say',
        'A 404 on GitHub and a 404 on GitLab are the same NotFoundError',
      ]"
    >
      <code class="font-mono text-[13px] text-highlighted">createProvider("github")</code> finds the
      token in env, then asks <code class="font-mono text-[13px] text-highlighted">gh</code>, and
      hands you nine resources with the same method shapes. Change the string, nothing else moves.
      This panel walks through {{ samples.length }} repositories on three hosts and swaps each
      recorded sample for the live answer from the docs worker as it arrives.
      <template #visual>
        <LandingRepo :sample="current" :tick="tick" @step="step" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Issues and pull requests"
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
      problem. A page is
      <code class="font-mono text-[13px] text-highlighted">{ items, hasNextPage, nextPage }</code>,
      a state is <code class="font-mono text-[13px] text-highlighted">open</code> or
      <code class="font-mono text-[13px] text-highlighted">closed</code>, and a pull request knows
      its branches, its head SHA and whether it is still a draft.
      <template #visual>
        <LandingPulls :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Commits and CI"
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
      <code class="font-mono text-[13px] text-highlighted">null</code> until there is one. Counts a
      platform withholds come back as
      <code class="font-mono text-[13px] text-highlighted">null</code>. Never as zero, zero would be
      a lie.
      <template #visual>
        <LandingHistory :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Review threads"
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
      <code class="font-mono text-[13px] text-highlighted">list</code> gives you is the id
      <code class="font-mono text-[13px] text-highlighted">reply</code> and
      <code class="font-mono text-[13px] text-highlighted">resolve</code> take back, whatever the
      platform calls it underneath.
      <template #visual>
        <LandingThreads :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Platforms"
      title="Three providers, four platforms"
      to="/platforms"
      link="All platforms"
      :checks="[
        'GitBucket speaks the GitHub API, so it is the GitHub provider with a baseURL and nothing more',
        'Forgejo and Codeberg are the Gitea provider with a baseURL',
        'Your own platform is one class extending Provider plus the typed mappers',
      ]"
    >
      GitHub wants <code class="font-mono text-[13px] text-highlighted">Authorization: token</code>,
      GitLab wants <code class="font-mono text-[13px] text-highlighted">Private-Token</code>, Gitea
      wants <code class="font-mono text-[13px] text-highlighted">limit</code> instead of
      <code class="font-mono text-[13px] text-highlighted">per_page</code>. Each provider keeps that
      to itself and maps its raw responses onto the shared types. The rest of the library never sees
      it.
      <template #visual>
        <div
          class="forges-frame grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-3 lg:grid-cols-5"
        >
          <NuxtLink
            v-for="(platform, i) in PLATFORMS"
            :key="platform.slug"
            :to="platform.to"
            class="group flex flex-col gap-3 border-muted px-4 py-4 transition-colors duration-500 hover:bg-muted"
            :class="{
              'border-t': i >= 2,
              'sm:border-t-0': i < 3,
              'lg:border-t-0': i < 5,
              'border-l': i % 2 === 1,
              'sm:border-l': i % 3 !== 0,
              'lg:border-l': i % 5 !== 0,
              'sm:border-l-0': i % 3 === 0,
              'lg:border-l-0!': i % 5 === 0,
              'forges-cell-active': platform.slug === activePlatform,
            }"
          >
            <UIcon
              :name="platform.icon"
              class="size-5 text-muted transition-colors duration-500 group-hover:text-primary"
              :class="{ 'text-primary': platform.slug === activePlatform }"
            />
            <span>
              <span class="block text-sm font-medium text-highlighted">{{ platform.label }}</span>
              <span class="mt-0.5 block font-mono text-[11px] text-dimmed"
                >"{{ platform.key }}"</span
              >
            </span>
          </NuxtLink>
          <NuxtLink
            to="/guide/custom"
            class="group flex flex-col gap-3 border-t border-muted px-4 py-4 transition-colors duration-500 hover:bg-muted sm:border-l lg:border-t-0"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-5 text-muted transition-colors duration-500 group-hover:text-primary"
            />
            <span>
              <span class="block text-sm font-medium text-highlighted">Yours</span>
              <span class="mt-0.5 block font-mono text-[11px] text-dimmed">extends Provider</span>
            </span>
          </NuxtLink>
        </div>
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Agents"
      title="Thirty tools, three hosts"
      to="/guide/agents"
      link="MCP, Pi and OMP"
      :checks="[
        'Reads fall back to anonymous access, writes and forges_users_authenticated need a credential',
        'Lists drop bodies and name the tool that reads one in full, so a busy page still fits in a context',
        'A self hosted FORGES_*_BASE_URL comes from the process environment, never from a tool argument',
      ]"
      reverse
    >
      <code class="font-mono text-[13px] text-highlighted">forges mcp</code> serves the tools over
      stdio, the Pi and OMP extensions render them in the terminal. All three call the same
      executors, so they answer identically and a fix lands once. Five tools write, and they say so
      in their annotations, so a client can gate them before a model gets creative.
      <template #visual>
        <LandingToolCall :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="One interface"
      title="Same calls, every provider"
      to="/guide"
      link="Getting started"
      :checks="[
        'repos, contributionTemplates, code, ciRuns, commits, issues, pullRequests, users, threads',
        'NotFoundError, AuthenticationError, PermissionError, RateLimitError with retryAfter',
        'Stable reads cached with an LRU keyed by host and token hash, item reads always fresh',
      ]"
    >
      <code class="font-mono text-[13px] text-highlighted">Provider</code> is the abstract base with
      the nine resource accessors. Concrete classes implement the typed mappers and the platform
      calls, nothing else leaks upward. Sub path imports give you one provider without dragging in
      the other two.
      <template #visual>
        <LandingRotatingCode :sample="current" />
      </template>
    </LandingFeature>

    <section class="forges-section">
      <div
        class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 text-center sm:px-12 lg:px-16"
      >
        <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-3xl">
          Start with one command
        </h2>
        <p class="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          Pre-1.0, so pin exact versions. And treat issue bodies, comments and review threads as
          text you did not write, because you did not, and someone out there knows that.
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-2">
          <UButton to="/guide" color="primary" trailing-icon="i-lucide-arrow-right">
            Read the guide
          </UButton>
          <UButton to="/explorer" color="neutral" variant="outline"> Open the explorer </UButton>
        </div>
      </div>
    </section>
  </div>
</template>
