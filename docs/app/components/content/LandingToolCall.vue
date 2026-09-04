<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { clip } from "../../utils/format";

const props = defineProps<{ sample: ForgeSample }>();

const repo = computed(() => props.sample.repository);
</script>

<template>
  <div class="forges-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="font-mono text-xs text-muted">
        <span class="text-dimmed">tool</span>
        <span class="ms-2 text-highlighted">forges_repos_get</span>
      </p>
      <p class="font-mono text-[11px] text-dimmed">MCP · Pi · OMP</p>
    </div>
    <div class="divide-y divide-muted">
      <div class="px-4 py-4">
        <p class="forges-eyebrow mb-3">input</p>
        <pre class="forges-tool"><code>{
  <span class="tok-key">"platform"</span>: <span class="tok-str">"<Transition name="forges-roll" mode="out-in"><span :key="sample.platform" class="forges-roll-slot">{{ sample.platform }}</span></Transition>"</span>,
  <span class="tok-key">"owner"</span>: <span class="tok-str">"<Transition name="forges-roll" mode="out-in"><span :key="sample.owner" class="forges-roll-slot">{{ sample.owner }}</span></Transition>"</span>,
  <span class="tok-key">"repo"</span>: <span class="tok-str">"<Transition name="forges-roll" mode="out-in"><span :key="sample.repo" class="forges-roll-slot">{{ sample.repo }}</span></Transition>"</span>
}</code></pre>
      </div>
      <div class="px-4 py-4">
        <p class="forges-eyebrow mb-3">output</p>
        <pre :key="repo.id" class="forges-tool forges-derive"><code>{
  <span class="tok-key">"id"</span>: <span class="tok-str">"{{ repo.id }}"</span>,
  <span class="tok-key">"fullName"</span>: <span class="tok-str">"{{ repo.fullName }}"</span>,
  <span class="tok-key">"description"</span>: <span class="tok-str">"{{ clip(repo.description, 48) }}"</span>,
  <span class="tok-key">"private"</span>: <span class="tok-kw">{{ repo.private }}</span>,
  <span class="tok-key">"defaultBranch"</span>: <span class="tok-str">"{{ repo.defaultBranch }}"</span>,
  <span class="tok-key">"isFork"</span>: <span class="tok-kw">{{ repo.isFork }}</span>,
  <span class="tok-key">"parent"</span>: {{ repo.parent ? `{ "fullName": "${repo.parent.fullName}" }` : "null" }},
  <span class="tok-key">"viewerPermission"</span>: <span class="tok-kw">null</span>,
  <span class="tok-key">"url"</span>: <span class="tok-str">"{{ repo.url }}"</span>
}</code></pre>
      </div>
    </div>
  </div>
</template>
