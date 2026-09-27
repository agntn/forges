<script setup lang="ts">
import { version } from "../../../../package.json";
import type { ForgeSample } from "../../utils/landing-fixtures";
import { PLATFORMS, PROVIDER_PLATFORMS } from "../../utils/platforms";

defineProps<{ sample: ForgeSample; samples: readonly ForgeSample[] }>();
const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const INSTALL = "pnpm add @agntn/forges";

const { copied, copy } = useCopied();
</script>

<template>
  <header class="forges-hero hero-page">
    <div class="hero-zone">
      <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
      <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
      <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
      <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

      <p class="console-id">
        <span class="console-id-tag">ID</span>
        <span>@agntn/forges</span>
        <span class="console-id-sep" aria-hidden="true">/</span>
        <span>v{{ version }}</span>
      </p>

      <h1 class="hero-title">One API. <span>Every forge.</span></h1>
      <p class="hero-lead">
        GitHub, GitLab, Gitea and GitBucket behind one TypeScript provider. Repositories, issues,
        pull requests, review threads, commits and CI come back in the same shape, and the token is
        found for you. Library, MCP server or Pi extension, your pick.
      </p>

      <dl class="hero-metrics">
        <div>
          <dt>Platforms</dt>
          <dd>{{ PLATFORMS.length }}</dd>
          <dd class="hero-metric-sub">{{ PROVIDER_PLATFORMS.length }} provider classes</dd>
        </div>
        <div>
          <dt>Resources</dt>
          <dd>10</dd>
          <dd class="hero-metric-sub">same methods on each</dd>
        </div>
        <div>
          <dt>Agent tools</dt>
          <dd class="hero-metric-accent">49</dd>
          <dd class="hero-metric-sub">11 of them write</dd>
        </div>
      </dl>

      <div class="console-actions">
        <UButton
          to="/guide"
          color="primary"
          variant="solid"
          trailing-icon="i-lucide-arrow-right"
          label="Get started"
        />
        <UButton
          to="https://github.com/agntn/forges"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          label="Star on GitHub"
        />
      </div>
      <div class="console-install">
        <span class="console-install-tag">Install</span>
        <code><span class="console-install-prompt">$</span> {{ INSTALL }}</code>
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'install' ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="copied === 'install' ? 'Copied' : 'Copy install command'"
          @click="copy('install', INSTALL)"
        />
      </div>
    </div>

    <!-- One repository read through one provider: the call runs down the rail into its answer. -->
    <div class="hero-instrument">
      <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
        <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
        <path
          :key="`${sample.platform}:${sample.repo}`"
          class="hero-circuit-live"
          d="M80 0V16L96 32V56"
          pathLength="1"
        />
        <path class="hero-circuit-seg" d="M96 38V48" />
        <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
      </svg>
      <span class="hero-circuit-tag" aria-hidden="true">repos.get</span>
      <LandingRepo
        :sample="sample"
        :samples="samples"
        @step="emit('step', $event)"
        @pause="emit('pause', $event)"
      />
    </div>
  </header>
</template>
