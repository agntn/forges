<script setup lang="ts">
import type { ForgeSample, SamplePullRequest } from "../../utils/landing-fixtures";
import { dateOnly, plainText, shortSha } from "../../utils/format";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const key = computed(() => `${props.sample.platform}:${props.sample.owner}/${props.sample.repo}`);
const call = computed(
  () => `pullRequests.list("${props.sample.owner}", "${props.sample.repo}", { state: "open" })`,
);
const rows = computed(() => props.sample.pullRequests.items.slice(0, 4));
const issues = computed(() => props.sample.issues.items.slice(0, 2));

/** Merged and draft say more than `open`, so they win the badge. */
function stateOf(pr: SamplePullRequest): "merged" | "draft" | "open" | "closed" {
  if (pr.merged) return "merged";
  if (pr.draft) return "draft";
  return pr.state;
}
</script>

<template>
  <section
    class="tool-console landing-pulls"
    aria-label="Open pull requests and issues of one repository"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="call">
        <span class="console-title pulls-call" tabindex="0"
          ><span class="console-tag">List</span>pullRequests.list(<Transition
            name="forges-roll"
            mode="out-in"
            ><span :key="key" class="forges-roll-slot tok-str"
              >"{{ sample.owner }}/{{ sample.repo }}"</span
            ></Transition
          >, …)</span
        >
      </UTooltip>
      <span class="console-meta"
        >{{ sample.pullRequests.items.length
        }}{{ sample.pullRequests.hasNextPage ? "+" : "" }} open</span
      >
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="key" class="console-cursor" />
    </div>

    <ol :key="key" class="console-rows console-animate pulls-rows">
      <li
        v-for="(pr, index) in rows"
        :key="pr.number"
        :style="{ animationDelay: `${index * 30}ms` }"
      >
        <span class="pulls-number">#{{ pr.number }}</span>
        <UTooltip :text="plainText(pr.title)">
          <a :href="pr.url" target="_blank" rel="noopener nofollow" class="pulls-title">{{
            plainText(pr.title)
          }}</a>
        </UTooltip>
        <UBadge
          color="neutral"
          :variant="stateOf(pr) === 'open' ? 'subtle' : 'outline'"
          :label="stateOf(pr)"
        />
        <span class="pulls-meta"
          ><span class="pulls-branch">{{ pr.sourceBranch }}</span> → {{ pr.targetBranch }} ·
          {{ shortSha(pr.headSha) }} · {{ pr.author }} · {{ dateOnly(pr.createdAt) }}</span
        >
      </li>
      <li v-if="rows.length === 0" class="pulls-empty">No open pull requests on this page.</li>
    </ol>

    <div class="pulls-issues">
      <p class="console-label console-rule-title">
        <span
          >issues.list
          <span aria-hidden="true"
            >[
            {{
              sample.issues.totalCount === null ? "" : `${sample.issues.totalCount} open, `
            }}oldest first ]</span
          ></span
        >
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ol :key="key" class="pulls-issue-list">
        <li v-for="issue in issues" :key="issue.number">
          <span class="pulls-number">#{{ issue.number }}</span>
          <UTooltip :text="plainText(issue.title)">
            <a :href="issue.url" target="_blank" rel="noopener nofollow" class="pulls-title">{{
              plainText(issue.title)
            }}</a>
          </UTooltip>
          <span class="pulls-labels">
            <span v-for="label in issue.labels.slice(0, 2)" :key="label" class="console-tag">{{
              label
            }}</span>
          </span>
        </li>
        <li v-if="issues.length === 0" class="pulls-empty">
          {{
            sample.platform === "github"
              ? "Only pull requests on this page. GitHub lists them as issues, the library drops them."
              : "No open issues on this page."
          }}
        </li>
      </ol>
    </div>

    <footer class="console-footer console-footer-plain">
      <span>merge request on GitLab, pull request here</span>
    </footer>
  </section>
</template>

<style scoped>
.pulls-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pulls-call :deep(.forges-roll-slot) {
  display: inline;
}
/* Number, title, state on the first line; branches, head, author and date under the title. */
.pulls-rows > li {
  grid-template-columns: 3.75rem minmax(0, 1fr) auto;
}
.pulls-number {
  color: var(--ui-text-dimmed);
  font-size: 12px;
}
.pulls-title {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.pulls-title:hover {
  color: var(--console-accent);
}
.pulls-meta {
  grid-column: 2 / -1;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
}
.pulls-branch {
  color: var(--ui-text-muted);
}
.pulls-rows > li.pulls-empty,
.pulls-issue-list > li.pulls-empty {
  display: block;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--ui-text-muted);
}
.pulls-issues {
  padding: 14px 20px 12px;
  border-top: 1px solid var(--console-line);
}
.pulls-issues > .console-rule-title {
  margin: 0 0 8px;
}
.pulls-issue-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pulls-issue-list > li {
  display: grid;
  grid-template-columns: 3.75rem minmax(0, 1fr) auto;
  gap: 16px;
  align-items: baseline;
}
.pulls-labels {
  display: flex;
  gap: 4px;
  max-width: 12rem;
  overflow: hidden;
}
.pulls-labels > .console-tag {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
}
@media (width < 400px) {
  .pulls-rows > li,
  .pulls-issue-list > li {
    grid-template-columns: 3rem minmax(0, 1fr) auto;
    gap: 4px 10px;
  }
  .pulls-issues {
    padding-inline: 14px;
  }
  .pulls-labels {
    display: none;
  }
}
</style>
