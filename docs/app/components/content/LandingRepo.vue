<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { clip, hostPath } from "../../utils/format";
import { platformIcon, platformLabel } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample; tick: number }>();

defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const repo = computed(() => props.sample.repository);

const rows = computed(() => [
  {
    label: "id",
    value: `"${repo.value.id}"`,
    note: "always a string, even when the API sends a number",
  },
  { label: "fullName", value: repo.value.fullName, note: "" },
  { label: "defaultBranch", value: repo.value.defaultBranch, note: "" },
  { label: "private", value: String(repo.value.private), note: "" },
  {
    label: "isFork",
    value: String(repo.value.isFork),
    note: repo.value.parent ? `parent ${repo.value.parent.fullName}` : "parent null",
  },
  { label: "cloneUrl", value: clip(hostPath(repo.value.cloneUrl), 44), note: "" },
  { label: "owner.login", value: repo.value.owner.login, note: "" },
]);
</script>

<template>
  <div
    class="forges-frame overflow-hidden rounded-xl"
    @mouseenter="$emit('pause', true)"
    @mouseleave="$emit('pause', false)"
  >
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted"
          >repos.get(<span class="tok-str"
            >"<Transition name="forges-roll" mode="out-in"
              ><span :key="sample.owner" class="forges-roll-slot">{{
                sample.owner
              }}</span></Transition
            >"</span
          >,
          <span class="tok-str"
            >"<Transition name="forges-roll" mode="out-in"
              ><span :key="sample.repo" class="forges-roll-slot">{{
                sample.repo
              }}</span></Transition
            >"</span
          >)</span
        >
      </p>
      <div class="flex shrink-0 items-center gap-1">
        <span class="forges-state" :class="sample.live ? 'forges-state-ok' : ''">{{
          sample.live ? "live" : "sample"
        }}</span>
        <button
          type="button"
          class="forges-copy"
          aria-label="Previous repository"
          @click="$emit('step', -1)"
        >
          <UIcon name="i-lucide-chevron-left" class="size-3.5" />
        </button>
        <button
          type="button"
          class="forges-copy"
          aria-label="Next repository"
          @click="$emit('step', 1)"
        >
          <UIcon name="i-lucide-chevron-right" class="size-3.5" />
        </button>
      </div>
    </div>
    <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
      <UIcon :name="platformIcon(sample.platform)" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ platformLabel(sample.platform) }}</span>
      <span class="font-mono text-[11px] text-dimmed"
        >createProvider("{{ sample.platform }}"{{
          sample.baseURL ? `, { baseURL: "${sample.baseURL}" }` : ""
        }})</span
      >
    </div>
    <div :key="repo.fullName" class="forges-derive px-4 pt-3">
      <p class="truncate text-sm font-medium text-highlighted">{{ repo.fullName }}</p>
      <p class="mt-1 text-[13px] leading-5 text-muted">
        {{ repo.description || "No description on the platform." }}
      </p>
    </div>
    <dl :key="repo.id" class="forges-kv forges-derive">
      <template v-for="row in rows" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd class="font-mono text-[13px]">
          {{ row.value }}
          <span v-if="row.note" class="ms-2 font-sans text-xs text-dimmed">{{ row.note }}</span>
        </dd>
      </template>
    </dl>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        same <span class="text-highlighted">Repository</span> from
        {{ platformLabel(sample.platform) }} as from every other platform
        <span class="mx-1">·</span>
        viewerPermission <span class="text-highlighted">null</span> when the API omits it
      </p>
    </div>
  </div>
</template>
