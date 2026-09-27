<script setup lang="ts">
import type { ForgeSample } from "../../utils/landing-fixtures";
import { clip, dateOnly, plainText } from "../../utils/format";
import { platformLabel } from "../../utils/platforms";

const props = defineProps<{ sample: ForgeSample }>();
const emit = defineEmits<{ pause: [paused: boolean] }>();

const key = computed(() => `${props.sample.platform}:${props.sample.owner}/${props.sample.repo}`);
const threads = computed(() => props.sample.threads);
const rows = computed(() => threads.value.items.slice(0, 2));

/** Where the flags come from, since that decides how much they can be trusted. */
const source = computed(() =>
  props.sample.platform === "github"
    ? "GraphQL"
    : props.sample.platform === "gitea"
      ? "per comment"
      : "REST",
);
</script>

<template>
  <section
    class="tool-console landing-threads"
    aria-label="Review threads of one pull request"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title threads-call"
        ><span class="console-tag">List</span>threads.list(<Transition
          name="forges-roll"
          mode="out-in"
          ><span :key="key" class="forges-roll-slot"
            ><span class="tok-str">"{{ sample.owner }}/{{ sample.repo }}"</span>,
            {{ threads.number ?? "n" }}</span
          ></Transition
        >)</span
      >
      <span class="console-meta">{{ source }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="key" class="console-cursor" />
    </div>

    <p v-if="rows.length === 0" :key="key" class="threads-empty">
      {{ platformLabel(sample.platform) }} answers <code>401</code> for discussions without a token,
      even on a public project. Surprised me too. With a token the same call gives each discussion
      as a <code>Thread</code> with a real <code>isResolved</code> and an
      <code>isOutdated</code> that's always false, because the API has no such flag.
    </p>
    <ol v-else :key="key" class="threads-list console-animate">
      <li
        v-for="(thread, index) in rows"
        :key="thread.id"
        :style="{ animationDelay: `${index * 45}ms` }"
      >
        <p class="threads-head">
          <UTooltip :text="thread.line === null ? thread.path : `${thread.path}:${thread.line}`">
            <span class="threads-path console-node" tabindex="0"
              >{{ thread.path
              }}<span v-if="thread.line !== null" class="threads-line"
                >:{{ thread.line }}</span
              ></span
            >
          </UTooltip>
          <UBadge
            :color="thread.isResolved ? 'neutral' : 'primary'"
            variant="outline"
            :label="thread.isResolved ? 'resolved' : 'unresolved'"
          />
          <UBadge v-if="thread.isOutdated" color="neutral" variant="outline" label="outdated" />
        </p>
        <ul class="threads-comments">
          <li v-for="comment in thread.comments" :key="comment.createdAt + comment.author">
            <span class="threads-author"
              >{{ comment.author }} · {{ dateOnly(comment.createdAt) }}</span
            >
            <span class="threads-body">{{ clip(plainText(comment.body), 120) }}</span>
          </li>
        </ul>
      </li>
    </ol>

    <footer class="console-footer console-footer-plain">
      <span
        ><code>reply</code>, <code>resolve</code> and <code>unresolve</code> take the same id
        back</span
      >
    </footer>
  </section>
</template>

<style scoped>
.threads-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.threads-call :deep(.forges-roll-slot) {
  display: inline;
}
.threads-empty {
  margin: 0;
  padding: 18px 20px 20px;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  color: var(--ui-text-muted);
}
.threads-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.threads-list > li {
  padding: 12px 20px 14px;
}
.threads-list > li + li {
  border-top: 1px solid var(--console-line);
}
.threads-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  margin: 0;
}
.threads-path {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.threads-line {
  color: var(--ui-text-dimmed);
}
/* Comments hang off the path on a rail, the author in mono over the text in the reading face. */
.threads-comments {
  display: grid;
  gap: 8px;
  margin: 8px 0 0 3px;
  padding: 0 0 0 13px;
  list-style: none;
  border-left: 1px solid var(--console-line);
}
.threads-comments > li {
  display: grid;
  gap: 2px;
}
.threads-author {
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.threads-body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
  overflow-wrap: anywhere;
}
.landing-threads code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ui-text-highlighted);
}
@media (width < 400px) {
  .threads-list > li,
  .threads-empty {
    padding-inline: 14px;
  }
}
</style>
