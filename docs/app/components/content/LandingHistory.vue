<script setup lang="ts">
import type { ForgeSample, SampleCiRun } from "../../utils/landing-fixtures";
import { dateOnly, firstLine, shortSha } from "../../utils/format";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const key = computed(() => `${props.sample.platform}:${props.sample.owner}/${props.sample.repo}`);
const commits = computed(() => props.sample.commits.slice(0, 4));
const runs = computed(() => props.sample.ciRuns.slice(0, 3));

/** The latest CI run for a revision, so a commit row can carry its conclusion. */
const runByRevision = computed(
  () => new Map(props.sample.ciRuns.map((run) => [run.revision, run])),
);

/** What the run system is called on this platform. */
const runKind = computed(() =>
  props.sample.platform === "gitlab"
    ? "pipelines"
    : props.sample.platform === "gitea"
      ? "Gitea Actions runs"
      : "GitHub Actions runs",
);

/** A failure is red, a run still going is the accent, a success stays bright and quiet. */
function badge(run: SampleCiRun): {
  color: "neutral" | "primary" | "error";
  variant: "subtle" | "outline";
  label: string;
} {
  if (run.status !== "completed")
    return { color: "primary", variant: "outline", label: run.status };
  if (run.conclusion === "success")
    return { color: "neutral", variant: "subtle", label: "success" };
  if (
    run.conclusion === "failure" ||
    run.conclusion === "timed_out" ||
    run.conclusion === "startup_failure"
  ) {
    return { color: "error", variant: "outline", label: run.conclusion };
  }
  return { color: "neutral", variant: "outline", label: run.conclusion ?? "null" };
}
</script>

<template>
  <section
    class="tool-console landing-history"
    aria-label="Recent commits and CI runs of one repository"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title history-call"
        ><span class="console-tag">List</span>commits.list(<Transition
          name="forges-roll"
          mode="out-in"
          ><span :key="key" class="forges-roll-slot tok-str"
            >"{{ sample.owner }}/{{ sample.repo }}"</span
          ></Transition
        >)</span
      >
      <span class="console-meta">default branch</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="key" class="console-cursor" />
    </div>

    <ol :key="key" class="console-rows console-animate history-rows">
      <li
        v-for="(commit, index) in commits"
        :key="commit.sha"
        :style="{ animationDelay: `${index * 30}ms` }"
      >
        <a :href="commit.url" target="_blank" rel="noopener nofollow" class="history-sha">{{
          shortSha(commit.sha)
        }}</a>
        <UTooltip :text="firstLine(commit.message)">
          <span class="history-message" tabindex="0">{{ firstLine(commit.message) }}</span>
        </UTooltip>
        <UBadge
          v-if="runByRevision.get(commit.sha)"
          v-bind="badge(runByRevision.get(commit.sha)!)"
        />
        <span v-else aria-hidden="true" />
        <span class="history-meta"
          >{{ commit.author.name }} · {{ dateOnly(commit.author.date)
          }}{{ commit.parents > 1 ? " · merge" : "" }}</span
        >
      </li>
    </ol>

    <div class="history-runs">
      <p class="console-label console-rule-title">
        <span
          >ciRuns.list <span aria-hidden="true">[ {{ runKind }} ]</span></span
        >
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ol :key="key" class="history-run-list">
        <li v-for="run in runs" :key="run.id">
          <a :href="run.url" target="_blank" rel="noopener nofollow" class="history-branch"
            >{{ run.branch }} <span>@ {{ shortSha(run.revision) }}</span></a
          >
          <span class="history-status">{{ run.status }}</span>
          <UBadge v-bind="badge(run)" />
        </li>
        <li v-if="runs.length === 0" class="history-none">No CI runs on this page.</li>
      </ol>
    </div>

    <footer class="console-footer console-footer-plain">
      <span><code>conclusion</code> stays null until there is one</span>
      <span class="console-meta">no patches in a list</span>
    </footer>
  </section>
</template>

<style scoped>
.history-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-call :deep(.forges-roll-slot) {
  display: inline;
}
.history-rows > li {
  grid-template-columns: 4.5rem minmax(0, 1fr) auto;
}
.history-sha {
  font-size: 12px;
  color: var(--console-accent) !important;
}
.history-message {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.history-meta {
  grid-column: 2 / -1;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
}
.history-none {
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.history-runs {
  padding: 14px 20px 12px;
  border-top: 1px solid var(--console-line);
}
.history-runs > .console-rule-title {
  margin: 0 0 8px;
}
.history-run-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.history-run-list > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
}
.history-branch {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.history-branch > span {
  color: var(--ui-text-dimmed);
}
.history-branch:hover {
  color: var(--console-accent);
}
.history-status {
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.landing-history code {
  color: var(--ui-text-highlighted);
}
@media (width < 400px) {
  .history-rows > li {
    grid-template-columns: 4rem minmax(0, 1fr) auto;
    gap: 4px 10px;
  }
  .history-runs {
    padding-inline: 14px;
  }
  .history-status {
    display: none;
  }
}
</style>
