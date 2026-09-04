<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { dateOnly, shortSha } from "../../utils/format";

const props = defineProps<{ sample: ForgeSample }>();

const commits = computed(() => props.sample.commits.slice(0, 4));

/** The latest CI run for a revision, so a commit row can carry its conclusion. */
const runByRevision = computed(
  () => new Map(props.sample.ciRuns.map((run) => [run.revision, run])),
);

const runs = computed(() => props.sample.ciRuns.slice(0, 3));

function conclusionClass(conclusion: string | null, status: string): string {
  if (status !== "completed") return "forges-state-warn";
  if (conclusion === "success") return "forges-state-ok";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure")
    return "forges-state-failed";
  return "";
}
</script>

<template>
  <div class="forges-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted"
          >commits.list(<span class="tok-str"
            >"<Transition name="forges-roll" mode="out-in"
              ><span :key="sample.repo" class="forges-roll-slot"
                >{{ sample.owner }}/{{ sample.repo }}</span
              ></Transition
            >"</span
          >)</span
        >
      </p>
      <span class="forges-state shrink-0" :class="sample.live ? 'forges-state-ok' : ''">{{
        sample.live ? "live" : "sample"
      }}</span>
    </div>
    <ol :key="`${sample.platform}-${sample.repo}`" class="forges-derive divide-y divide-muted">
      <li v-for="commit in commits" :key="commit.sha" class="flex items-start gap-3 px-4 py-3">
        <UIcon name="i-lucide-git-commit-horizontal" class="mt-0.5 size-4 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-highlighted">{{ commit.message }}</p>
          <p class="mt-0.5 truncate font-mono text-[11px] text-dimmed">
            <span class="text-primary">{{ shortSha(commit.sha) }}</span>
            <span class="mx-1">·</span>{{ commit.author.name }} <span class="mx-1">·</span
            >{{ dateOnly(commit.author.date) }}
            <span v-if="commit.parents > 1" class="mx-1">· merge</span>
          </p>
        </div>
        <span
          v-if="runByRevision.get(commit.sha)"
          class="forges-state shrink-0"
          :class="
            conclusionClass(
              runByRevision.get(commit.sha)!.conclusion,
              runByRevision.get(commit.sha)!.status,
            )
          "
        >
          {{ runByRevision.get(commit.sha)!.conclusion ?? runByRevision.get(commit.sha)!.status }}
        </span>
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-2.5">
      <p class="font-mono text-[11px] text-dimmed">
        ciRuns.list ·
        {{
          sample.platform === "gitlab"
            ? "pipelines"
            : sample.platform === "gitea"
              ? "Gitea Actions runs"
              : "GitHub Actions runs"
        }}
        · status → conclusion
      </p>
    </div>
    <ol class="divide-y divide-muted">
      <li v-for="run in runs" :key="run.id" class="flex items-center gap-3 px-4 py-2.5">
        <UIcon name="i-lucide-play-circle" class="size-4 shrink-0 text-muted" />
        <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-highlighted"
          >{{ run.branch }} <span class="text-dimmed">@ {{ shortSha(run.revision) }}</span></span
        >
        <span class="font-mono text-[11px] text-dimmed">{{ run.status }}</span>
        <span class="forges-state" :class="conclusionClass(run.conclusion, run.status)">{{
          run.conclusion ?? "null"
        }}</span>
      </li>
      <li v-if="runs.length === 0" class="px-4 py-3 text-sm text-muted">
        No CI runs on this page.
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        <span class="text-highlighted">CommitSummary</span> without patches
        <span class="mx-1">·</span>
        <span class="text-highlighted">CiRun</span> with one lifecycle and one terminal outcome on
        every platform
      </p>
    </div>
  </div>
</template>
