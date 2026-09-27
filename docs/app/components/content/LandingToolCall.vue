<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { platformIcon } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const slug = computed(() => `${props.sample.owner}/${props.sample.repo}`);
const key = computed(() => `${props.sample.platform}:${slug.value}`);
const title = computed(
  () => `forges_repos_get({ platform: "${props.sample.platform}", repo: "${slug.value}" })`,
);

/** What the tool hands a model: `result()` in src/tool-operations.ts stringifies the platform and the repository. */
const text = computed(() =>
  JSON.stringify({ platform: props.sample.platform, result: props.sample.repository }),
);

/** The arguments a model sends, then the one field it usually came for. */
const rows = computed(() => [
  { label: "platform", value: `"${props.sample.platform}"` },
  { label: "repo", value: `"${slug.value}"`, note: "owner/name in one string is fine" },
  { label: "result.id", value: `"${props.sample.repository.id}"`, accent: true },
  { label: "bytes", value: `${text.value.length} characters of JSON` },
]);
</script>

<template>
  <section
    class="tool-console landing-call"
    aria-label="One tool call"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="title">
        <span class="console-title call-title" tabindex="0"
          ><span class="console-tag">Call</span>forges_repos_get(<Transition
            name="forges-roll"
            mode="out-in"
            ><span :key="key" class="forges-roll-slot tok-str">"{{ slug }}"</span></Transition
          >)</span
        >
      </UTooltip>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="key" class="console-cursor" />
    </div>

    <div class="call-subject">
      <div :key="key" class="console-scan" aria-hidden="true" />
      <div class="call-identity">
        <ConsoleReticle :key="key" :icon="platformIcon(sample.platform)" />
        <div class="call-name">
          <span class="console-label">Tool / <span class="console-label-key">repos</span></span>
          <h3>forges_repos_get</h3>
          <p class="call-note">
            A model asks for a repository by name and gets back the same JSON a script would, from
            whichever forge it named.
          </p>
        </div>
      </div>
      <div class="console-readout">
        <dl :key="key" class="console-readout-rows console-animate">
          <div
            v-for="(row, index) in rows"
            :key="row.label"
            :style="{ animationDelay: `${index * 45}ms` }"
          >
            <dt>{{ row.label }}</dt>
            <dd :class="{ 'console-accent': row.accent }">
              <UTooltip v-if="row.note" :text="row.note">
                <span class="call-line" tabindex="0">{{ row.value }}</span>
              </UTooltip>
              <span v-else class="call-line">{{ row.value }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <ConsoleResponse :title="title" :text="text" />

    <footer class="console-footer console-footer-plain">
      <span aria-label="Supported hosts: MCP, Pi and OMP">MCP · Pi · OMP</span>
      <span class="console-meta">forges mcp · stdio</span>
    </footer>
  </section>
</template>

<style scoped>
.call-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.call-title :deep(.forges-roll-slot) {
  display: inline;
}
.call-subject {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.call-subject > :not(.console-scan) {
  position: relative;
}
.call-identity {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.call-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.call-name h3 {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 400;
  line-height: 1.2;
  color: var(--ui-text-highlighted);
  overflow-wrap: anywhere;
}
.call-note {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
}
.landing-call .console-readout-rows > div {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
.landing-call .console-readout-rows dt {
  text-transform: none;
  letter-spacing: 0.02em;
}
.call-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (width < 400px) {
  .call-subject {
    padding-inline: 14px;
  }
  .call-identity {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
