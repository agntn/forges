<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { PLATFORMS, PROVIDER_PLATFORMS } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

/** A cell per platform, then one for a provider of your own; the platform the panels show is lit. */
const cells = computed(() => [
  ...PLATFORMS.map((platform) => ({
    key: platform.slug,
    to: platform.to,
    icon: platform.icon,
    label: platform.label,
    call: `"${platform.key}"`,
    line: platform.authHeader,
    about: `${platform.label} · ${platform.threads} · code search ${platform.codeSearch}`,
    current: platform.slug === props.sample.platform,
  })),
  {
    key: "yours",
    to: "/guide/custom",
    icon: "i-lucide-plus",
    label: "Yours",
    call: "extends Provider",
    line: "typed mappers",
    about: "One class extending Provider plus the typed mappers",
    current: false,
  },
]);
</script>

<template>
  <section
    class="tool-console console-wide landing-platforms"
    aria-label="Every platform the providers speak"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">Call</span>createProvider(platform)</span
      >
      <span class="console-meta"
        >{{ PROVIDER_PLATFORMS.length }} classes · {{ PLATFORMS.length }} platforms</span
      >
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.platform" class="console-cursor" />
    </div>

    <ul class="platform-cells">
      <li v-for="cell in cells" :key="cell.key">
        <UTooltip :text="cell.about">
          <NuxtLink
            :to="cell.to"
            class="platform-cell"
            :data-current="cell.current ? '' : undefined"
            :aria-label="cell.about"
          >
            <span class="platform-head">
              <UIcon :name="cell.icon" class="platform-icon" aria-hidden="true" />
              <span class="platform-name">{{ cell.label }}</span>
              <span class="platform-node" aria-hidden="true" />
            </span>
            <span class="platform-call">{{ cell.call }}</span>
            <span class="platform-line">{{ cell.line }}</span>
          </NuxtLink>
        </UTooltip>
      </li>
    </ul>

    <footer class="console-footer console-footer-plain">
      <span class="platform-legend"
        ><span class="platform-node" data-current aria-hidden="true" /> in the panels now</span
      >
      <NuxtLink to="/platforms" class="platform-link"
        ><span aria-hidden="true">→ </span>auth, endpoints and traps per platform</NuxtLink
      >
    </footer>
  </section>
</template>

<style scoped>
.platform-cells {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  margin: 0;
  padding: 16px 20px 18px;
  list-style: none;
}
/* A cell per platform: glyph, name and node, then the string you pass and the header it signs with. */
.platform-cell {
  display: grid;
  gap: 6px;
  height: 100%;
  padding: 10px 12px 12px;
  box-shadow: inset 0 0 0 1px var(--console-line);
  transition: box-shadow 0.3s ease;
}
.platform-head {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 6px;
  gap: 8px;
  align-items: center;
}
.platform-icon {
  width: 16px;
  height: 16px;
  color: var(--ui-text-dimmed);
  transition: color 0.3s ease;
}
.platform-name {
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.platform-node {
  display: inline-block;
  width: 6px;
  height: 6px;
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.platform-node[data-current] {
  background: var(--console-accent);
  box-shadow: none;
}
.platform-call {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.platform-line {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
}
.platform-cell[data-current] {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--console-accent) 55%, transparent);
}
.platform-cell[data-current] .platform-icon {
  color: var(--console-accent);
}
.platform-cell[data-current] .platform-node {
  background: var(--console-accent);
  box-shadow: none;
}
.platform-cell:hover .platform-icon {
  color: var(--ui-text-muted);
}
.platform-cell:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
.platform-legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.platform-link {
  margin-left: auto;
  color: var(--ui-text-highlighted);
}
.platform-link:hover {
  color: var(--console-accent);
}
.platform-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 56rem) {
  .platform-cells {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (width < 640px) {
  .platform-cells {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-inline: 14px;
  }
  .platform-legend {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .platform-cell,
  .platform-icon {
    transition: none;
  }
}
</style>
