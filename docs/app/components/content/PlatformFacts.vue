<script setup lang="ts">
import { platformInfo } from "../../utils/platforms";

const props = defineProps<{ platform: string }>();

const info = computed(() => platformInfo(props.platform));

const facts = computed(() => {
  const platform = info.value;
  if (!platform) {
    return [];
  }
  return [
    { label: "provider", value: `createProvider("${platform.key}")`, mono: true },
    { label: "auth header", value: platform.authHeader, mono: true },
    { label: "env vars", value: platform.envVars.join(", "), mono: true },
    { label: "anonymous reads", value: platform.anonymousReads, mono: false },
  ];
});
</script>

<template>
  <dl
    class="forges-frame not-prose my-6 grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-4"
  >
    <div
      v-for="(fact, index) in facts"
      :key="fact.label"
      class="border-muted px-4 py-3.5"
      :class="{
        'border-t sm:border-t-0': index >= 2,
        'border-l': index % 2 === 1,
        'sm:border-l': index > 0,
      }"
    >
      <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">
        {{ fact.label }}
      </dt>
      <dd class="mt-1 text-sm text-highlighted" :class="{ 'font-mono text-[13px]': fact.mono }">
        {{ fact.value }}
      </dd>
    </div>
  </dl>
</template>
