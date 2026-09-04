<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { dateOnly, plainText, shortSha } from "../../utils/format";

const props = defineProps<{ sample: ForgeSample }>();

const rows = computed(() => props.sample.pullRequests.items.slice(0, 4));
const issues = computed(() => props.sample.issues.items.slice(0, 2));

function stateOf(pr: ForgeSample["pullRequests"]["items"][number]): string {
  if (pr.merged) return "merged";
  if (pr.draft) return "draft";
  return pr.state;
}
</script>

<template>
  <div class="forges-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted"
          >pullRequests.list(<span class="tok-str"
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
          >, { state: <span class="tok-str">"open"</span> })</span
        >
      </p>
      <span class="forges-state shrink-0" :class="sample.live ? 'forges-state-ok' : ''">{{
        sample.live ? "live" : "sample"
      }}</span>
    </div>
    <ol :key="`${sample.platform}-${sample.repo}`" class="forges-derive divide-y divide-muted">
      <li v-for="pr in rows" :key="pr.number" class="px-4 py-3">
        <div class="flex items-start gap-3">
          <UIcon
            name="i-lucide-git-pull-request"
            class="mt-0.5 size-4 shrink-0"
            :class="pr.draft ? 'text-dimmed' : 'text-primary'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">
              <span class="me-1.5 font-mono text-[11px] text-dimmed">#{{ pr.number }}</span
              >{{ plainText(pr.title) }}
            </p>
            <p class="mt-0.5 truncate font-mono text-[11px] text-dimmed">
              <span class="text-primary">{{ pr.sourceBranch }}</span> → {{ pr.targetBranch }}
              <span class="mx-1">·</span>{{ shortSha(pr.headSha) }} <span class="mx-1">·</span
              >{{ pr.author }} <span class="mx-1">·</span>{{ dateOnly(pr.createdAt) }}
            </p>
          </div>
          <span
            class="forges-state shrink-0"
            :class="{
              'forges-state-ok': stateOf(pr) === 'open',
              'forges-state-warn': stateOf(pr) === 'draft',
            }"
            >{{ stateOf(pr) }}</span
          >
        </div>
      </li>
      <li v-if="rows.length === 0" class="px-4 py-4 text-sm text-muted">
        No open pull requests on this page.
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-2.5">
      <p class="font-mono text-[11px] text-dimmed">
        issues.list ·
        {{ sample.issues.totalCount === null ? "" : `${sample.issues.totalCount} open · ` }}oldest
        first on every platform
      </p>
    </div>
    <ol class="divide-y divide-muted">
      <li v-for="issue in issues" :key="issue.number" class="flex items-start gap-3 px-4 py-2.5">
        <UIcon name="i-lucide-circle-dot" class="mt-0.5 size-4 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-highlighted">
            <span class="me-1.5 font-mono text-[11px] text-dimmed">#{{ issue.number }}</span
            >{{ plainText(issue.title) }}
          </p>
          <p v-if="issue.labels.length" class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="label in issue.labels"
              :key="label"
              class="forges-chip forges-chip-small"
              >{{ label }}</span
            >
          </p>
        </div>
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        <span class="text-highlighted">merge request</span> on GitLab,
        <span class="text-highlighted">pull request</span> here
        <span class="mx-1">·</span>
        <span class="text-highlighted">iid</span> becomes
        <span class="text-highlighted">number</span>
        <span class="mx-1">·</span>
        hasNextPage <span class="text-highlighted">{{ sample.pullRequests.hasNextPage }}</span>
      </p>
    </div>
  </div>
</template>
