<script setup lang="ts">
import { EXPLORER_PLATFORMS, PLATFORMS, platformInfo } from "../../utils/platforms";

const props = defineProps<{ platform: string }>();

const info = computed(() => platformInfo(props.platform));
const position = computed(() => PLATFORMS.findIndex((row) => row.slug === props.platform) + 1);

/** The class behind the platform, and whether it only gets there through a baseURL. */
const provider = computed(() => {
  const key = info.value?.key ?? "github";
  return {
    name: {
      github: "GitHubProvider",
      gitlab: "GitLabProvider",
      gitea: "GiteaProvider",
      artifacts: "ArtifactsProvider",
    }[key],
    path: `@agntn/forges/${key}`,
    borrowed: info.value !== undefined && info.value.slug !== info.value.key,
  };
});

const create = computed(() =>
  provider.value.borrowed
    ? `createProvider("${info.value?.key}", { baseURL })`
    : `createProvider("${info.value?.key}")`,
);

const explorer = computed(() =>
  info.value &&
  !provider.value.borrowed &&
  EXPLORER_PLATFORMS.some((row) => row.key === info.value?.key)
    ? `/explorer?op=platforms&platform=${info.value.key}`
    : null,
);
</script>

<template>
  <section
    v-if="info"
    class="tool-console console-wide not-prose my-6 platform-dossier"
    aria-label="Platform record"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">ID</span>{{ info.slug
        }}<span class="console-file"
          >{{ String(position).padStart(2, "0") }} /
          {{ String(PLATFORMS.length).padStart(2, "0") }}</span
        ></span
      >
      <span class="console-meta">{{ info.host }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true"><span class="console-cursor" /></div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="platform-left">
        <div class="console-identity-block">
          <ConsoleReticle :key="info.slug" :icon="info.icon" />
          <div class="console-name">
            <span class="console-label"
              >Platform / <span class="console-label-key">{{ info.key }}</span></span
            >
            <h3>{{ info.label }}</h3>
            <p class="console-about">
              Spoken by <code>{{ provider.name }}</code
              >{{ provider.borrowed ? ", pointed at your host with a baseURL" : "" }}. Same
              resources, same shapes, its own quirks kept inside.
            </p>
          </div>
        </div>
        <div class="platform-access">
          <p class="console-label console-rule-title">
            <span>Access <span aria-hidden="true">[ create · import · token ]</span></span>
            <span class="console-mark" aria-hidden="true" />
          </p>
          <p class="console-lead">
            <span class="console-tag">Create</span>
            <code class="platform-code">{{ create }}</code>
            <span class="console-leader" aria-hidden="true" />
          </p>
          <p class="console-lead">
            <span class="console-tag">Import</span>
            <code class="platform-code"
              ><span class="tok-kw">import</span> { {{ provider.name }} }
              <span class="tok-kw">from</span>
              <span class="tok-str">"{{ provider.path }}"</span></code
            >
            <span class="console-leader" aria-hidden="true" />
          </p>
          <p class="console-lead">
            <span class="console-tag">Env</span>
            <code class="platform-code">{{ info.envVars.join(", ") }}</code>
            <span class="console-leader" aria-hidden="true" />
          </p>
          <p class="console-lead">
            <span class="console-tag">CLI</span>
            <code class="platform-code">{{ info.cli }}</code>
            <span class="console-leader" aria-hidden="true" />
          </p>
          <p v-if="info.configFile" class="console-lead">
            <span class="console-tag">Config</span>
            <code class="platform-code">{{ info.configFile }}</code>
            <span class="console-leader" aria-hidden="true" />
          </p>
          <p v-if="explorer" class="console-lead">
            <span class="console-tag">Try</span>
            <NuxtLink :to="explorer"
              >explorer<span class="platform-dim"> against the docs worker</span></NuxtLink
            >
            <span class="console-leader" aria-hidden="true" />
          </p>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Header</dt>
            <dd class="console-accent">{{ info.authHeader }}</dd>
          </div>
          <div>
            <dt>Anonymous</dt>
            <dd>{{ info.anonymousReads }}</dd>
          </div>
          <div>
            <dt>Threads</dt>
            <dd>{{ info.threads }}</dd>
          </div>
          <div>
            <dt>Code search</dt>
            <dd>{{ info.codeSearch }}</dd>
          </div>
          <div>
            <dt>Templates</dt>
            <dd>{{ info.templates }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <NuxtLink to="/platforms" class="platform-back"
        ><span aria-hidden="true">← </span>every platform</NuxtLink
      >
      <span class="console-meta">tokens stay local</span>
    </footer>
  </section>
</template>

<style scoped>
.platform-dossier .console-about code,
.platform-code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ui-text-highlighted);
}
.platform-code {
  min-width: 0;
  overflow-wrap: anywhere;
}
/* The left column: the platform, then how to reach it, so the band has no empty corner. */
.platform-left {
  display: grid;
  gap: 18px;
  align-content: start;
  min-width: 0;
}
.platform-access > .console-rule-title {
  margin: 0 0 4px;
}
.platform-dim {
  color: var(--ui-text-dimmed);
}
.platform-back {
  color: var(--ui-text-highlighted);
}
.platform-back:hover {
  color: var(--console-accent);
}
.platform-dossier :deep(.console-readout-rows > div) {
  grid-template-columns: 7.5rem minmax(0, 1fr);
}
.platform-dossier :deep(.console-readout-rows dd) {
  font-family: var(--font-sans);
  font-size: 14px;
}
.platform-dossier :deep(.console-readout-rows dd.console-accent) {
  font-family: var(--font-mono);
  font-size: 13px;
}
@media (width < 640px) {
  .platform-dossier .console-lead .console-leader {
    display: none;
  }
}
</style>
