<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { platformIcon, platformInfo } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const info = computed(() => platformInfo(props.sample.platform)!);

/** The four places `resolveToken()` looks, in its order; the first one that answers wins. */
const steps = computed(() => [
  { tag: "Explicit", text: "{ token } in the config", note: "wins, even an empty string" },
  { tag: "Env", text: info.value.envVars.join(", "), note: "first one set" },
  { tag: "CLI", text: info.value.cli, note: "stored login" },
  {
    tag: "Config",
    text: info.value.configFile ?? "none",
    note: info.value.configFile ? "when the CLI is missing" : "",
  },
]);
</script>

<template>
  <section
    class="tool-console landing-token"
    aria-label="Where createProvider looks for a token"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title token-call"
        ><span class="console-tag">Call</span>createProvider(<Transition
          name="forges-roll"
          mode="out-in"
          ><span :key="sample.platform" class="forges-roll-slot tok-str"
            >"{{ sample.platform }}"</span
          ></Transition
        >)</span
      >
      <span class="console-meta">first hit wins</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.platform" class="console-cursor" />
    </div>

    <div class="token-subject">
      <div :key="sample.platform" class="console-scan" aria-hidden="true" />
      <div class="token-identity">
        <ConsoleReticle :key="sample.platform" :icon="platformIcon(sample.platform)" />
        <div class="token-name">
          <span class="console-label"
            >Token / <span class="console-label-key">{{ sample.platform }}</span></span
          >
          <h3>{{ info.label }}</h3>
          <p class="token-note">
            No token argument, no problem. The provider walks four places and signs every request
            with whatever it finds first.
          </p>
        </div>
      </div>
    </div>

    <div :key="sample.platform" class="token-steps console-draw">
      <p class="console-label console-rule-title">
        <span>resolveToken <span aria-hidden="true">[ in this order ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <p
        v-for="(step, index) in steps"
        :key="step.tag"
        class="console-lead token-lead"
        :style="{ '--lead-delay': `${index * 60}ms` }"
      >
        <span class="console-tag">{{ step.tag }}</span>
        <UTooltip :text="step.note ? `${step.text} · ${step.note}` : step.text">
          <span class="token-text" tabindex="0">{{ step.text }}</span>
        </UTooltip>
        <span class="console-leader" aria-hidden="true" />
      </p>
    </div>

    <dl :key="`${sample.platform}-rows`" class="console-readout-rows console-animate token-rows">
      <div>
        <dt>header</dt>
        <dd class="console-accent">{{ info.authHeader }}</dd>
      </div>
      <div>
        <dt>anonymous</dt>
        <dd>{{ info.anonymousReads }}</dd>
      </div>
    </dl>

    <footer class="console-footer console-footer-plain">
      <span><code>{ token: "" }</code> reads anonymously, nothing found throws</span>
    </footer>
  </section>
</template>

<style scoped>
.token-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.token-call :deep(.forges-roll-slot) {
  display: inline;
}
.token-subject {
  position: relative;
  padding: 18px 20px 16px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.token-subject > :not(.console-scan) {
  position: relative;
}
.token-identity {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.token-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.token-name h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ui-text-highlighted);
}
.token-note {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
}
.token-steps {
  padding: 14px 20px 14px;
  border-top: 1px solid var(--console-line);
}
.token-steps > .console-rule-title {
  margin: 0 0 4px;
}
.token-lead {
  flex-wrap: nowrap;
}
.token-steps.console-draw .token-lead .console-leader {
  animation-delay: var(--lead-delay);
}
.token-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.token-rows {
  border-top: 1px solid var(--console-line);
}
.token-rows > div {
  grid-template-columns: 6.5rem minmax(0, 1fr);
  padding-inline: 20px;
}
.landing-token code {
  color: var(--ui-text-highlighted);
}
@media (width < 640px) {
  .token-lead .console-leader {
    display: none;
  }
}
@media (width < 400px) {
  .token-subject,
  .token-steps {
    padding-inline: 14px;
  }
  .token-identity {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
  .token-rows > div {
    padding-inline: 14px;
  }
}
</style>
