<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { hostPath } from "../../utils/format";
import { platformIcon, platformInfo } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample; samples: readonly ForgeSample[] }>();
const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

/** One key per sample, so the cursor, the scan and the reticle move only when the repository does. */
const key = computed(() => `${props.sample.platform}:${props.sample.owner}/${props.sample.repo}`);
const repo = computed(() => props.sample.repository);
const call = computed(() => `repos.get("${props.sample.owner}", "${props.sample.repo}")`);

const explorer = computed(
  () =>
    `/explorer?op=repo&platform=${props.sample.platform}&repo=${props.sample.owner}/${props.sample.repo}${props.sample.baseURL ? `&host=${props.sample.host}` : ""}`,
);

/** Every sample's name in the same cell, the others hidden, so the band keeps the tallest one's height. */
const names = computed(() =>
  props.samples.map((other) => ({
    key: `${other.platform}:${other.owner}/${other.repo}`,
    platform: other.platform,
    fullName: other.repository.fullName,
    about: other.repository.description || "No description on the platform.",
  })),
);

/** How a commit's CI run ended, as the map draws it: hatched green, red, accent while it runs, empty without a run. */
function runState(sha: string): "success" | "failure" | "running" | "other" | "none" {
  const run = props.sample.ciRuns.find((row) => row.revision === sha);
  if (!run) return "none";
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure" || run.conclusion === "timed_out") return "failure";
  return "other";
}

/**
 * Three lanes, one per open pull request, empty slots kept so the band never changes height. A lane
 * joins the bus into HEAD only when it targets the default branch; where it forked is not in the data.
 */
const lanes = computed(() => {
  const main = repo.value.defaultBranch;
  const rows = props.sample.pullRequests.items.slice(0, 3).map((pr) => ({
    key: String(pr.number),
    number: `#${pr.number}`,
    branch: pr.sourceBranch,
    head: pr.headSha.slice(0, 7),
    target: pr.targetBranch,
    joins: pr.targetBranch === main,
    draft: pr.draft,
    about: `#${pr.number} ${pr.sourceBranch} → ${pr.targetBranch} · head ${pr.headSha.slice(0, 7)}${pr.draft ? " · draft" : ""}`,
    empty: false,
  }));
  while (rows.length < 3) {
    rows.push({
      key: `empty-${rows.length}`,
      number: "",
      branch: "",
      head: "",
      target: "",
      joins: false,
      draft: false,
      about: "",
      empty: true,
    });
  }
  return rows;
});

/** The bus starts at the first lane that merges into the default branch and runs down into HEAD. */
const busStart = computed(() => lanes.value.findIndex((lane) => lane.joins));

function busPart(index: number): "start" | "through" | "none" {
  if (busStart.value === -1 || index < busStart.value) return "none";
  return index === busStart.value ? "start" : "through";
}

/** The default branch's last five commits, oldest on the left so HEAD sits where the bus lands. */
const commits = computed(() =>
  props.sample.commits
    .slice(0, 5)
    .reverse()
    .map((commit) => ({
      sha: commit.sha.slice(0, 7),
      state: runState(commit.sha),
      about: `${commit.sha.slice(0, 7)} · ${commit.message.split("\n", 1)[0]}`,
    })),
);

/** The three latest CI runs for the right column, empty slots kept so the band holds its height. */
const runs = computed(() => {
  const rows = props.sample.ciRuns.slice(0, 3).map((run) => {
    const state = runState(run.revision);
    return {
      key: run.id,
      branch: run.branch,
      sha: run.revision.slice(0, 7),
      status: run.status,
      badge:
        run.status !== "completed"
          ? { color: "primary" as const, variant: "outline" as const, label: run.status }
          : run.conclusion === "success"
            ? { color: "neutral" as const, variant: "subtle" as const, label: "success" }
            : state === "failure"
              ? {
                  color: "error" as const,
                  variant: "outline" as const,
                  label: run.conclusion ?? "failure",
                }
              : {
                  color: "neutral" as const,
                  variant: "outline" as const,
                  label: run.conclusion ?? "null",
                },
      url: run.url,
      empty: false,
    };
  });
  while (rows.length < 3) {
    rows.push({
      key: `empty-${rows.length}`,
      branch: "",
      sha: "",
      status: "",
      badge: { color: "neutral", variant: "outline", label: "" },
      url: "",
      empty: true,
    });
  }
  return rows;
});

/** One tick per CI run on the page: a finished success hatched, anything else open in the accent. */
const ticks = computed(() =>
  props.sample.ciRuns.map((run) => ({
    id: run.id,
    open: !(run.status === "completed" && run.conclusion === "success"),
  })),
);
const green = computed(() => ticks.value.filter((tick) => !tick.open).length);
</script>

<template>
  <section
    class="tool-console console-wide landing-repo"
    aria-label="One repository through one provider"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="`await forge.${call}`">
        <span class="console-title repo-call" tabindex="0"
          ><span class="console-tag">Call</span>repos.get(<Transition
            name="forges-roll"
            mode="out-in"
            ><span :key="key" class="forges-roll-slot tok-str"
              >"{{ sample.owner }}", "{{ sample.repo }}"</span
            ></Transition
          >)</span
        >
      </UTooltip>
      <span class="console-meta">{{ sample.host }} · {{ sample.live ? "live" : "sample" }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="key" class="console-cursor" />
    </div>

    <div class="console-band console-subject-band repo-subject">
      <div :key="key" class="console-scan" aria-hidden="true" />
      <div class="repo-left">
        <div class="console-identity-block">
          <ConsoleReticle :key="key" :icon="platformIcon(sample.platform)" />
          <div class="repo-names">
            <div
              v-for="other in names"
              :key="other.key"
              class="console-name"
              :class="{ 'repo-sizer': other.key !== key }"
              :aria-hidden="other.key !== key ? 'true' : undefined"
            >
              <span class="console-label"
                >Repository / <span class="console-label-key">{{ other.platform }}</span></span
              >
              <h3 class="console-name-mono">{{ other.fullName }}</h3>
              <p class="console-about">{{ other.about }}</p>
            </div>
          </div>
        </div>

        <!-- Open pull requests as lanes heading into the default branch, its last commits with their CI. -->
        <div :key="key" class="repo-map">
          <p class="console-label console-rule-title">
            <span
              >Branches
              <span aria-hidden="true"
                >[ open pulls into
                <span class="console-label-key">{{ repo.defaultBranch }}</span> ]</span
              ></span
            >
            <span class="console-mark" aria-hidden="true" />
          </p>
          <div class="map">
            <div
              v-for="(lane, index) in lanes"
              :key="lane.key"
              class="map-lane"
              :data-empty="lane.empty ? '' : undefined"
              :data-draft="lane.draft ? '' : undefined"
              :style="{ '--delay': `${index * 90}ms` }"
            >
              <span class="map-number">{{ lane.number }}</span>
              <UTooltip v-if="!lane.empty" :text="lane.about">
                <span class="map-branch" tabindex="0">{{ lane.branch }}</span>
              </UTooltip>
              <span v-else class="map-branch map-none">no open pull request</span>
              <span class="map-wire" :data-joins="lane.joins ? '' : undefined">
                <span v-if="!lane.empty && !lane.joins" class="map-target"
                  >→ {{ lane.target }}</span
                >
              </span>
              <span class="map-head">{{ lane.head }}</span>
              <span
                class="map-join"
                :data-bus="busPart(index)"
                :data-joins="lane.joins ? '' : undefined"
              >
                <span v-if="lane.joins" class="map-node" />
              </span>
            </div>
            <div class="map-main" :data-bus="busStart === -1 ? 'none' : 'end'">
              <span class="console-tag map-trunk">{{ repo.defaultBranch }}</span>
              <span class="map-rail">
                <UTooltip v-for="commit in commits" :key="commit.sha" :text="commit.about">
                  <span class="map-commit" tabindex="0" :data-state="commit.state">
                    <span class="map-dot" />
                    <span class="map-sha">{{ commit.sha }}</span>
                  </span>
                </UTooltip>
              </span>
              <span class="map-join map-join-head">
                <span class="map-node map-node-head" />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="repo-right">
        <div class="console-readout">
          <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
            <circle cx="3" cy="12" r="2.5" />
            <path d="M5.5 12H14L22 20H32" />
          </svg>
          <dl :key="key" class="console-readout-rows console-animate">
            <div>
              <dt>id</dt>
              <dd class="console-accent">
                <UTooltip text="Always a string, even when the API sends a number">
                  <span class="repo-line" tabindex="0">"{{ repo.id }}"</span>
                </UTooltip>
              </dd>
            </div>
            <div>
              <dt>defaultBranch</dt>
              <dd>
                <span class="repo-line">{{ repo.defaultBranch }}</span>
              </dd>
            </div>
            <div>
              <dt>private</dt>
              <dd>
                <span class="repo-line">{{ repo.private }}</span>
              </dd>
            </div>
            <div>
              <dt>isFork</dt>
              <dd>
                <UTooltip v-if="repo.parent" :text="`parent ${repo.parent.fullName}`">
                  <span class="repo-line" tabindex="0">true · {{ repo.parent.fullName }}</span>
                </UTooltip>
                <span v-else class="repo-line">{{ repo.isFork }}</span>
              </dd>
            </div>
            <div>
              <dt>cloneUrl</dt>
              <dd>
                <UTooltip :text="repo.cloneUrl">
                  <span class="repo-line" tabindex="0">{{ hostPath(repo.cloneUrl) }}</span>
                </UTooltip>
              </dd>
            </div>
          </dl>
          <div
            class="console-gauge"
            :aria-label="`${green} of ${ticks.length} recent CI runs finished green`"
          >
            <span :key="key" class="console-ticks" aria-hidden="true">
              <span
                v-for="(tick, index) in ticks"
                :key="tick.id"
                :class="tick.open ? 'console-tick-open' : 'console-tick-closed'"
                :style="{ animationDelay: `${index * 12}ms` }"
              />
            </span>
            <span class="console-gauge-read">ci green {{ green }} / {{ ticks.length }}</span>
          </div>
        </div>

        <!-- The runs behind the ticks: which branch, which revision, how it ended. -->
        <div :key="`${key}-runs`" class="repo-runs">
          <p class="console-label console-rule-title">
            <span>CI <span aria-hidden="true">[ latest runs ]</span></span>
            <span class="console-mark" aria-hidden="true" />
          </p>
          <ol class="repo-run-list console-animate">
            <li
              v-for="(run, index) in runs"
              :key="run.key"
              :style="{ animationDelay: `${index * 45}ms` }"
            >
              <template v-if="!run.empty">
                <a :href="run.url" target="_blank" rel="noopener nofollow" class="repo-run-branch"
                  >{{ run.branch }} <span>@ {{ run.sha }}</span></a
                >
                <UBadge v-bind="run.badge" />
              </template>
              <span v-else class="repo-run-none">no run</span>
            </li>
          </ol>
        </div>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <NuxtLink :to="explorer" class="repo-link"
        ><span aria-hidden="true">→ </span>{{ platformInfo(sample.platform)?.label }}
        <span>· open in the explorer</span></NuxtLink
      >
      <div class="console-controls" aria-label="Sample repositories">
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-left"
          aria-label="Previous repository"
          @click="emit('step', -1)"
        />
        <span>Repository</span>
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-right"
          aria-label="Next repository"
          @click="emit('step', 1)"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.repo-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repo-call :deep(.forges-roll-slot) {
  display: inline;
}
.repo-names {
  display: grid;
  min-width: 0;
}
.repo-names > .console-name {
  grid-area: 1 / 1;
}
.repo-sizer {
  visibility: hidden;
}
.repo-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.landing-repo :deep(.console-readout-rows > div) {
  grid-template-columns: 7.5rem minmax(0, 1fr);
}
.landing-repo :deep(.console-readout-rows dt) {
  text-transform: none;
  letter-spacing: 0.02em;
}
/* The left column: the repository, then the forges that could have answered, so no corner stays empty. */
.repo-left {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 18px;
  min-width: 0;
}
/* The right column: the readout, then the runs its gauge counts, so it ends where the map ends. */
.repo-right {
  display: grid;
  gap: 18px;
  align-content: start;
  min-width: 0;
}
.repo-runs > .console-rule-title {
  margin: 0 0 8px;
}
.repo-run-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.repo-run-list > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 28px;
}
.repo-run-branch {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.repo-run-branch > span {
  color: var(--ui-text-dimmed);
}
.repo-run-branch:hover {
  color: var(--console-accent);
}
.repo-run-none {
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
/* The map takes whatever height the readout column leaves, so neither column ends in a hole. */
.repo-map {
  display: grid;
  grid-template-rows: auto 1fr;
}
.repo-map > .console-rule-title {
  margin: 0 0 10px;
}
/* Lanes and the trunk share one grid: number, branch, wire, head, and the join column the bus runs down. */
.map {
  display: grid;
  grid-template-rows: repeat(3, minmax(28px, 1fr)) auto;
}
.map-lane,
.map-main {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 10rem) minmax(24px, 1fr) 4rem 22px;
  align-items: center;
  min-height: 28px;
}
.map-number {
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.map-branch {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.map-none {
  color: var(--ui-text-dimmed);
}
.map-lane[data-draft] .map-branch {
  color: var(--ui-text-muted);
}
/* The wire: dashed for a pull request not merged yet, drawn from the left once per repository. */
.map-wire {
  position: relative;
  display: flex;
  min-width: 0;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
  margin-inline: 10px 8px;
}
.map-wire::before {
  content: "";
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  border-top: 1px dashed var(--console-corner);
  transform-origin: left;
  animation: map-draw 520ms ease-out var(--delay, 0ms) both;
}
.map-lane[data-draft] .map-wire::before {
  border-top-style: dotted;
  border-color: var(--console-line);
}
.map-lane[data-empty] .map-wire::before {
  border-top: 1px dotted var(--console-line);
}
.map-target {
  position: relative;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
}
.map-head {
  font-size: 11px;
  color: var(--ui-text-muted);
}
/* The join column: a stub into the bus and the node; the bus itself is this column's vertical line. */
.map-join {
  position: relative;
  align-self: stretch;
}
.map-join::before {
  content: "";
  position: absolute;
  left: 50%;
  border-left: 1px solid var(--console-corner);
}
.map-join[data-bus="start"]::before {
  top: 50%;
  bottom: 0;
}
.map-join[data-bus="through"]::before {
  top: 0;
  bottom: 0;
}
.map-join[data-bus="none"]::before {
  content: none;
}
.map-main[data-bus="end"] .map-join-head::before {
  top: 0;
  bottom: 50%;
}
.map-main[data-bus="none"] .map-join-head::before {
  content: none;
}
.map-join[data-joins]::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 50%;
  width: calc(50% + 8px);
  border-top: 1px solid var(--console-corner);
}
.map-node {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  width: 7px;
  height: 7px;
  background: var(--ui-bg);
  box-shadow: inset 0 0 0 1px var(--console-corner);
  transform: translate(-50%, -50%);
}
.map-node-head {
  width: 9px;
  height: 9px;
  background: var(--console-accent);
  box-shadow: none;
}
/* The trunk: the default branch as a tag, its commits on a solid rail, HEAD where the bus lands. */
.map-main {
  min-height: 44px;
  margin-top: 4px;
}
.map-trunk {
  justify-self: start;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: none;
  color: var(--ui-text-highlighted);
}
.map-rail {
  position: relative;
  display: flex;
  grid-column: 2 / 5;
  justify-content: space-between;
  align-items: flex-start;
  margin-left: 12px;
  padding-top: 13px;
}
.map-rail::before {
  content: "";
  position: absolute;
  top: 17px;
  right: -11px;
  left: 0;
  border-top: 1px solid var(--console-corner);
}
.map-commit {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 5px;
}
.map-dot {
  width: 9px;
  height: 9px;
  background: var(--ui-bg);
  box-shadow: inset 0 0 0 1px var(--console-corner);
  animation: map-pop 260ms ease-out both;
}
.map-commit[data-state="success"] .map-dot {
  background: repeating-linear-gradient(180deg, var(--console-corner) 0 2px, var(--ui-bg) 2px 3px);
}
.map-commit[data-state="failure"] .map-dot {
  background: var(--forges-del);
  box-shadow: none;
}
.map-commit[data-state="running"] .map-dot {
  box-shadow: inset 0 0 0 1px var(--console-accent);
}
.map-sha {
  font-size: 10px;
  color: var(--ui-text-dimmed);
}
.map-commit:hover .map-sha,
.map-commit:focus-visible .map-sha {
  color: var(--ui-text-highlighted);
}
.map-commit:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
@keyframes map-draw {
  from {
    transform: scaleX(0);
  }
}
@keyframes map-pop {
  from {
    transform: scale(0.3);
  }
}
@media (prefers-reduced-motion: reduce) {
  .map-wire::before,
  .map-dot {
    animation: none;
  }
}
.repo-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.repo-link > span:last-child {
  color: var(--ui-text-dimmed);
}
.repo-link:hover {
  color: var(--console-accent);
}
.repo-link:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (width < 640px) {
  .map-lane,
  .map-main {
    grid-template-columns: 3rem minmax(0, 1fr) 16px 3.75rem 22px;
  }
  .map-target {
    display: none;
  }
  .map-rail .map-commit:nth-child(-n + 2) {
    display: none;
  }
  .repo-link > span:last-child {
    display: none;
  }
}
</style>
