<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { clip, dateOnly, plainText } from "../../utils/format";
import { platformLabel } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample }>();

const threads = computed(() => props.sample.threads);
const rows = computed(() => threads.value.items.slice(0, 2));
</script>

<template>
  <div class="forges-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted"
          >threads.list(<span class="tok-str"
            >"<Transition name="forges-roll" mode="out-in"
              ><span :key="sample.repo" class="forges-roll-slot"
                >{{ sample.owner }}/{{ sample.repo }}</span
              ></Transition
            >"</span
          >,
          <Transition name="forges-roll" mode="out-in"
            ><span :key="threads.number ?? 'none'" class="forges-roll-slot tok-kw">{{
              threads.number ?? "n"
            }}</span></Transition
          >)</span
        >
      </p>
      <span class="forges-state shrink-0" :class="sample.live ? 'forges-state-ok' : ''">{{
        sample.live ? "live" : "sample"
      }}</span>
    </div>
    <div
      v-if="rows.length === 0"
      :key="sample.platform"
      class="forges-derive px-4 py-6 text-sm leading-6 text-muted"
    >
      {{ platformLabel(sample.platform) }} answers
      <span class="font-mono text-highlighted">401</span> for discussions without a token, even on a
      public project. Surprised me too. With a token the same call gives each discussion as a
      <span class="font-mono text-highlighted">Thread</span> with a real
      <span class="font-mono text-highlighted">isResolved</span> and an
      <span class="font-mono text-highlighted">isOutdated</span> that is always false, because the
      API has no such flag.
    </div>
    <ol
      v-else
      :key="`${sample.platform}-${threads.number}`"
      class="forges-derive divide-y divide-muted"
    >
      <li v-for="thread in rows" :key="thread.id" class="px-4 py-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-messages-square" class="size-4 shrink-0 text-primary" />
          <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-highlighted"
            >{{ thread.path
            }}<span v-if="thread.line !== null" class="text-dimmed">:{{ thread.line }}</span></span
          >
          <span
            class="forges-state"
            :class="thread.isResolved ? 'forges-state-ok' : 'forges-state-warn'"
            >{{ thread.isResolved ? "resolved" : "unresolved" }}</span
          >
          <span v-if="thread.isOutdated" class="forges-state">outdated</span>
        </div>
        <ul class="mt-2 space-y-2">
          <li
            v-for="comment in thread.comments"
            :key="comment.createdAt + comment.author"
            class="ps-6"
          >
            <p class="font-mono text-[11px] text-dimmed">
              {{ comment.author }} <span class="mx-1">·</span> {{ dateOnly(comment.createdAt) }}
            </p>
            <p class="mt-0.5 text-[13px] leading-5 text-muted">
              {{ clip(plainText(comment.body), 150) }}
            </p>
          </li>
        </ul>
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        <span class="text-highlighted">reply</span>,
        <span class="text-highlighted">resolve</span> and
        <span class="text-highlighted">unresolve</span> take the same thread id back
        <span class="mx-1">·</span>
        {{
          sample.platform === "github"
            ? "GraphQL on GitHub, so the flags are real"
            : sample.platform === "gitea"
              ? "one thread per review comment on Gitea"
              : "REST discussions on GitLab"
        }}
      </p>
    </div>
  </div>
</template>
