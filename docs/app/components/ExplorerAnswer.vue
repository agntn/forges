<script setup lang="ts">
import type {
  Operation,
  PageAnswer,
  PlatformsAnswer,
  RepoAnswer,
  ThreadsAnswer,
  UserAnswer,
  WireCiRun,
  WireCommit,
  WireIssue,
  WirePullRequest,
} from "../utils/explorer";
import { OPERATIONS } from "../utils/explorer";
import { dateOnly, firstLine, hostPath, plainText, shortSha } from "../utils/format";
import { PROVIDER_PLATFORMS, platformIcon, platformLabel } from "../utils/platforms";

const props = defineProps<{
  operation: Operation;
  platform: string;
  call: string;
  loading: boolean;
  error?: string;
  repo?: RepoAnswer;
  issues?: PageAnswer<WireIssue>;
  pulls?: PageAnswer<WirePullRequest>;
  commits?: PageAnswer<WireCommit>;
  ci?: PageAnswer<WireCiRun>;
  threads?: ThreadsAnswer;
  user?: UserAnswer;
  platforms?: PlatformsAnswer;
}>();
const emit = defineEmits<{ threads: [pr: WirePullRequest] }>();

const op = computed(() => OPERATIONS.find((row) => row.key === props.operation)!);

/** The answer on screen, whatever the operation, for the meta line and the raw dialog. */
const answer = computed(() => {
  switch (props.operation) {
    case "repo":
      return props.repo;
    case "issues":
      return props.issues;
    case "pulls":
      return props.pulls;
    case "commits":
      return props.commits;
    case "ci":
      return props.ci;
    case "threads":
      return props.threads;
    case "user":
      return props.user;
    default:
      return props.platforms;
  }
});

const page = computed(() => {
  const value = answer.value;
  return value && "items" in value ? (value as PageAnswer<unknown>) : undefined;
});

const fetchedAt = computed(() => {
  const value = answer.value;
  return value && "fetchedAt" in value ? value.fetchedAt : undefined;
});

const raw = computed(() => (answer.value ? JSON.stringify(answer.value, null, 2) : ""));

/** One key per answer, so the cursor sweeps and the rows slide in only when the data changes. */
const key = computed(() => `${props.operation}:${fetchedAt.value ?? ""}:${raw.value.length}`);

function prState(pr: WirePullRequest): string {
  if (pr.merged) return "merged";
  if (pr.draft) return "draft";
  return pr.state;
}

/** A failure is red, a run still going is the accent, a success stays bright and quiet. */
function runBadge(run: WireCiRun): {
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

/** An empty string stays visible as what it is instead of a dash. */
function orEmpty(value: string): string {
  return value || "empty string";
}
</script>

<template>
  <section class="tool-console console-wide explorer-answer" aria-live="polite">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="call">
        <span class="console-title answer-call" tabindex="0"
          ><span class="console-tag">{{ op.tag }}</span
          >{{ call }}</span
        >
      </UTooltip>
      <span v-if="page && !loading" class="console-meta"
        >{{ page.items.length }} on this page · hasNextPage {{ page.hasNextPage }}</span
      >
      <span v-else-if="fetchedAt && !loading" class="console-meta"
        >fetched {{ dateOnly(fetchedAt) }}</span
      >
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span
        :key="loading ? 'busy' : key"
        class="console-cursor"
        :class="{ 'console-cursor-busy': loading }"
      />
    </div>

    <p v-if="loading" class="answer-note">Asking {{ platformLabel(platform) }}…</p>

    <div v-else-if="error" class="answer-error">
      <UAlert color="error" variant="outline" icon="i-lucide-circle-alert" :title="error" />
    </div>

    <!-- A repository: the subject band of a dossier, the fields in the readout. -->
    <div
      v-else-if="operation === 'repo' && repo"
      :key="key"
      class="console-band console-subject-band"
    >
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="key" :icon="platformIcon(repo.platform)" />
        <div class="console-name">
          <span class="console-label"
            >Repository / <span class="console-label-key">{{ repo.platform }}</span></span
          >
          <h3 class="console-name-mono">
            <a :href="repo.repository.url" target="_blank" rel="noopener nofollow">{{
              repo.repository.fullName
            }}</a>
          </h3>
          <p class="console-about">
            {{ plainText(repo.repository.description) || "No description on the platform." }}
          </p>
        </div>
      </div>
      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows console-animate answer-rows">
          <div>
            <dt>id</dt>
            <dd class="console-accent">"{{ repo.repository.id }}"</dd>
          </div>
          <div>
            <dt>defaultBranch</dt>
            <dd>{{ repo.repository.defaultBranch }}</dd>
          </div>
          <div>
            <dt>private</dt>
            <dd>{{ repo.repository.private }}</dd>
          </div>
          <div>
            <dt>isFork</dt>
            <dd>
              {{ repo.repository.isFork
              }}{{ repo.repository.parent ? ` · ${repo.repository.parent.fullName}` : "" }}
            </dd>
          </div>
          <div>
            <dt>cloneUrl</dt>
            <dd>{{ hostPath(repo.repository.cloneUrl) }}</dd>
          </div>
          <div>
            <dt>owner.login</dt>
            <dd>{{ repo.repository.owner.login }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <ol
      v-else-if="operation === 'issues' && issues"
      :key="key"
      class="console-rows console-animate answer-list"
    >
      <li
        v-for="(issue, index) in issues.items"
        :key="issue.number"
        :style="{ animationDelay: `${Math.min(index * 30, 600)}ms` }"
      >
        <span class="answer-number">#{{ issue.number }}</span>
        <a :href="issue.url" target="_blank" rel="noopener nofollow" class="answer-title">{{
          plainText(issue.title)
        }}</a>
        <UBadge
          color="neutral"
          :variant="issue.state === 'open' ? 'subtle' : 'outline'"
          :label="issue.state"
        />
        <span class="answer-meta"
          >{{ issue.author }} · {{ dateOnly(issue.createdAt)
          }}{{ issue.assignees.length ? ` · assigned ${issue.assignees.join(", ")}` : "" }}</span
        >
        <span v-if="issue.labels.length" class="answer-labels">
          <span v-for="label in issue.labels" :key="label" class="console-tag">{{ label }}</span>
        </span>
      </li>
      <li v-if="issues.items.length === 0" class="answer-empty">No issues in that state.</li>
    </ol>

    <ol
      v-else-if="operation === 'pulls' && pulls"
      :key="key"
      class="console-rows console-animate answer-list answer-pulls"
    >
      <li
        v-for="(pr, index) in pulls.items"
        :key="pr.number"
        :style="{ animationDelay: `${Math.min(index * 30, 600)}ms` }"
      >
        <span class="answer-number">#{{ pr.number }}</span>
        <a :href="pr.url" target="_blank" rel="noopener nofollow" class="answer-title">{{
          plainText(pr.title)
        }}</a>
        <span class="answer-actions">
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-messages-square"
            label="threads"
            :aria-label="`Review threads of #${pr.number}`"
            @click="emit('threads', pr)"
          />
          <UBadge
            color="neutral"
            :variant="prState(pr) === 'open' ? 'subtle' : 'outline'"
            :label="prState(pr)"
          />
        </span>
        <span class="answer-meta"
          ><span class="answer-branch">{{ pr.sourceBranch }}</span> → {{ pr.targetBranch }} ·
          {{ shortSha(pr.headSha) }} · {{ pr.author }} · {{ dateOnly(pr.createdAt) }} · mergeable
          {{ pr.mergeable === null ? "null" : pr.mergeable
          }}{{ pr.mergeStatus ? ` (${pr.mergeStatus})` : "" }}</span
        >
      </li>
      <li v-if="pulls.items.length === 0" class="answer-empty">No pull requests in that state.</li>
    </ol>

    <ol
      v-else-if="operation === 'commits' && commits"
      :key="key"
      class="console-rows console-animate answer-list answer-commits"
    >
      <li
        v-for="(commit, index) in commits.items"
        :key="commit.sha"
        :style="{ animationDelay: `${Math.min(index * 30, 600)}ms` }"
      >
        <a :href="commit.url" target="_blank" rel="noopener nofollow" class="answer-sha">{{
          shortSha(commit.sha)
        }}</a>
        <span class="answer-title">{{ firstLine(commit.message) }}</span>
        <span class="answer-meta"
          >{{ commit.author.name }} · {{ dateOnly(commit.author.date)
          }}{{ commit.parents > 1 ? " · merge" : "" }}</span
        >
      </li>
      <li v-if="commits.items.length === 0" class="answer-empty">No commits on this page.</li>
    </ol>

    <ol
      v-else-if="operation === 'ci' && ci"
      :key="key"
      class="console-rows console-animate answer-list answer-ci"
    >
      <li
        v-for="(run, index) in ci.items"
        :key="run.id"
        :style="{ animationDelay: `${Math.min(index * 30, 600)}ms` }"
      >
        <a :href="run.url" target="_blank" rel="noopener nofollow" class="answer-title answer-mono"
          >{{ run.branch }} <span class="answer-dim">@ {{ shortSha(run.revision) }}</span></a
        >
        <span class="answer-status">{{ run.status }}</span>
        <UBadge v-bind="runBadge(run)" />
        <span class="answer-meta">id {{ run.id }}</span>
      </li>
      <li v-if="ci.items.length === 0" class="answer-empty">No CI runs reported.</li>
    </ol>

    <template v-else-if="operation === 'threads' && threads">
      <p v-if="threads.items.length === 0" class="answer-note">
        No review threads on #{{ threads.number }}.
      </p>
      <ol v-else :key="key" class="answer-threads console-animate">
        <li
          v-for="(thread, index) in threads.items"
          :key="thread.id"
          :style="{ animationDelay: `${index * 45}ms` }"
        >
          <p class="answer-thread-head">
            <span class="answer-path console-node"
              >{{ thread.path
              }}<span v-if="thread.line !== null" class="answer-dim">:{{ thread.line }}</span></span
            >
            <UBadge
              :color="thread.isResolved ? 'neutral' : 'primary'"
              variant="outline"
              :label="thread.isResolved ? 'resolved' : 'unresolved'"
            />
            <UBadge v-if="thread.isOutdated" color="neutral" variant="outline" label="outdated" />
          </p>
          <ul class="answer-comments">
            <li v-for="comment in thread.comments" :key="comment.createdAt + comment.author">
              <span class="answer-meta"
                >{{ comment.author }} · {{ dateOnly(comment.createdAt) }}</span
              >
              <span class="answer-body">{{ plainText(comment.body) }}</span>
            </li>
          </ul>
        </li>
      </ol>
    </template>

    <div
      v-else-if="operation === 'user' && user"
      :key="key"
      class="console-band console-subject-band"
    >
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="key" icon="i-lucide-user-round" />
        <div class="console-name">
          <span class="console-label"
            >User / <span class="console-label-key">{{ user.platform }}</span></span
          >
          <h3 class="console-name-mono">
            <a :href="user.user.url" target="_blank" rel="noopener nofollow">{{
              user.user.login
            }}</a>
          </h3>
          <p class="console-about">
            {{
              [user.user.name, plainText(user.user.bio)].filter(Boolean).join(". ") ||
              "No name or bio on the profile."
            }}
          </p>
        </div>
      </div>
      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows console-animate answer-rows">
          <div>
            <dt>id</dt>
            <dd class="console-accent">"{{ user.user.id }}"</dd>
          </div>
          <div>
            <dt>company</dt>
            <dd :class="{ 'answer-dim': !user.user.company }">{{ orEmpty(user.user.company) }}</dd>
          </div>
          <div>
            <dt>location</dt>
            <dd :class="{ 'answer-dim': !user.user.location }">
              {{ orEmpty(user.user.location) }}
            </dd>
          </div>
          <div>
            <dt>website</dt>
            <dd :class="{ 'answer-dim': !user.user.website }">
              {{ user.user.website ? hostPath(user.user.website) : "empty string" }}
            </dd>
          </div>
          <div>
            <dt>followers</dt>
            <dd>{{ user.user.followers }} · following {{ user.user.following }}</dd>
          </div>
          <div>
            <dt>createdAt</dt>
            <dd :class="{ 'answer-dim': !user.user.createdAt }">
              {{ dateOnly(user.user.createdAt) || "empty string" }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <ol
      v-else-if="operation === 'platforms' && platforms"
      :key="key"
      class="console-rows console-animate answer-list answer-platforms"
    >
      <li v-for="row in platforms.platforms" :key="row.platform">
        <NuxtLink
          :to="PROVIDER_PLATFORMS.find((entry) => entry.key === row.platform)?.to ?? '/platforms'"
          class="answer-title answer-platform"
        >
          <UIcon :name="platformIcon(row.platform)" class="answer-icon" aria-hidden="true" />
          {{ platformLabel(row.platform) }}
        </NuxtLink>
        <span class="answer-status">{{ row.host }}</span>
        <UBadge
          color="neutral"
          :variant="row.authenticated ? 'subtle' : 'outline'"
          :label="row.authenticated ? 'authenticated' : 'anonymous'"
        />
        <span class="answer-meta"
          >threads
          {{ row.platform === "gitea" ? "yes" : row.authenticated ? "yes" : "need a token" }} · code
          search
          {{
            row.platform === "gitea"
              ? "unsupported"
              : row.platform === "gitlab"
                ? "token, Premium for global"
                : "yes"
          }}</span
        >
      </li>
    </ol>

    <p v-else class="answer-note">Pick an operation and run it.</p>

    <ConsoleResponse
      v-if="answer && !loading && !error"
      :title="call"
      :text="raw"
      label="Full answer"
      :source="op.route"
      description="The complete JSON the docs worker answered, before this page picked its fields."
    />

    <footer class="console-footer console-footer-plain">
      <span>Titles, labels and comments are somebody else's text</span>
      <span class="console-meta">cached by the worker</span>
    </footer>
  </section>
</template>

<style scoped>
.answer-call {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.answer-note {
  margin: 0;
  padding: 18px 20px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--ui-text-muted);
}
.answer-error {
  padding: 16px 20px;
}
.answer-rows > div {
  grid-template-columns: 7.5rem minmax(0, 1fr);
}
.answer-rows dt {
  text-transform: none;
  letter-spacing: 0.02em;
}
.console-name h3 a:hover {
  color: var(--console-accent);
}
/* A row: number, title and state on one line, who, when and where under the title. */
.answer-list > li {
  grid-template-columns: 4.5rem minmax(0, 1fr) auto;
}
.answer-commits > li {
  grid-template-columns: 4.5rem minmax(0, 1fr);
}
.answer-ci > li,
.answer-platforms > li {
  grid-template-columns: minmax(0, 1fr) auto auto;
}
.answer-ci .answer-meta,
.answer-platforms .answer-meta {
  grid-column: 1 / -1;
}
.answer-number {
  font-size: 12px;
  color: var(--ui-text-dimmed);
}
.answer-sha {
  font-size: 12px;
  color: var(--console-accent) !important;
}
.answer-title {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.answer-mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
.answer-platform {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.answer-icon {
  width: 14px;
  height: 14px;
  color: var(--ui-text-muted);
}
.answer-meta {
  grid-column: 2 / -1;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
}
.answer-branch {
  color: var(--ui-text-muted);
}
.answer-dim {
  color: var(--ui-text-dimmed);
}
.answer-status {
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.answer-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.answer-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  grid-column: 2 / -1;
}
.answer-labels > .console-tag {
  margin: 0;
  text-transform: none;
}
.answer-empty {
  display: block !important;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--ui-text-muted);
}
.answer-threads {
  margin: 0;
  padding: 0;
  list-style: none;
}
.answer-threads > li {
  padding: 12px 20px 14px;
  border-top: 1px solid var(--console-line);
}
.answer-thread-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  margin: 0;
}
.answer-path {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.answer-comments {
  display: grid;
  gap: 8px;
  margin: 8px 0 0 3px;
  padding: 0 0 0 13px;
  list-style: none;
  border-left: 1px solid var(--console-line);
}
.answer-comments > li {
  display: grid;
  gap: 2px;
}
.answer-comments .answer-meta {
  grid-column: auto;
}
.answer-body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
  overflow-wrap: anywhere;
}
@media (width < 640px) {
  .answer-list > li {
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    gap: 4px 10px;
  }
  .answer-status {
    display: none;
  }
  /* Narrow, the pull request's actions drop under its meta line instead of squeezing the title. */
  .answer-pulls > li {
    grid-template-columns: 3.5rem minmax(0, 1fr);
  }
  .answer-pulls .answer-actions {
    grid-column: 2;
    grid-row: 3;
  }
}
</style>
