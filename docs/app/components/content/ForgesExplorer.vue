<script setup lang="ts">
import {
  clip,
  dateOnly,
  hostPath,
  plainText,
  pluralize,
  shortSha,
  splitSlug,
} from "../../utils/format";
import { PROVIDER_PLATFORMS, platformIcon, platformLabel } from "../../utils/platforms";

interface WireIssue {
  number: number;
  title: string;
  state: string;
  labels: string[];
  author: string;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface WirePullRequest extends WireIssue {
  draft: boolean;
  merged: boolean;
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  mergeable: boolean | null;
  mergeStatus: string;
}

interface WireCommit {
  sha: string;
  message: string;
  author: { name: string; date: string };
  parents: number;
  url: string;
}

interface WireCiRun {
  id: string;
  branch: string;
  revision: string;
  status: string;
  conclusion: string | null;
  url: string;
}

interface WireThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: { author: string; body: string; createdAt: string }[];
}

interface RepoAnswer {
  platform: string;
  repository: {
    id: string;
    name: string;
    fullName: string;
    description: string;
    private: boolean;
    defaultBranch: string;
    url: string;
    cloneUrl: string;
    isFork: boolean;
    parent: { fullName: string; url: string } | null;
    owner: { login: string; avatarUrl: string };
  };
  fetchedAt: string;
}

interface PageAnswer<T> {
  platform: string;
  items: T[];
  hasNextPage: boolean;
  totalCount?: number | null;
  fetchedAt: string;
}

interface ThreadsAnswer extends PageAnswer<WireThread> {
  number: number;
}

interface UserAnswer {
  platform: string;
  user: {
    id: string;
    login: string;
    name: string;
    avatarUrl: string;
    bio: string;
    company: string;
    location: string;
    website: string;
    followers: number;
    following: number;
    createdAt: string;
    url: string;
  };
  fetchedAt: string;
}

interface PlatformsAnswer {
  version: string;
  platforms: { platform: string; authenticated: boolean; host: string }[];
}

type Operation = "repo" | "issues" | "pulls" | "commits" | "ci" | "threads" | "user" | "platforms";

const OPERATIONS: ReadonlyArray<{ key: Operation; label: string; icon: string; call: string }> = [
  { key: "repo", label: "Repository", icon: "i-lucide-folder-git-2", call: "repos.get" },
  { key: "issues", label: "Issues", icon: "i-lucide-circle-dot", call: "issues.list" },
  {
    key: "pulls",
    label: "Pull requests",
    icon: "i-lucide-git-pull-request",
    call: "pullRequests.list",
  },
  {
    key: "commits",
    label: "Commits",
    icon: "i-lucide-git-commit-horizontal",
    call: "commits.list",
  },
  { key: "ci", label: "CI runs", icon: "i-lucide-play-circle", call: "ciRuns.list" },
  { key: "threads", label: "Threads", icon: "i-lucide-messages-square", call: "threads.list" },
  { key: "user", label: "User", icon: "i-lucide-user", call: "users.get" },
  { key: "platforms", label: "Platforms", icon: "i-lucide-server", call: "" },
];

const EXAMPLES = [
  { platform: "github", host: "", slug: "nitrojs/nitro" },
  { platform: "gitlab", host: "", slug: "gitlab-org/cli" },
  { platform: "gitea", host: "codeberg.org", slug: "forgejo/forgejo" },
] as const;

/** Hosts the worker will talk to for Gitea. Anything else needs FORGES_GITEA_BASE_URL on the worker. */
const GITEA_HOSTS = ["gitea.com", "codeberg.org"] as const;

const router = useRouter();
const route = useRoute();

const operation = ref<Operation>("repo");
const platform = ref<string>("github");
const giteaHost = ref<string>("codeberg.org");
const slug = ref("nitrojs/nitro");
const number = ref<number | "">("");
const username = ref("pi0");
const state = ref<"open" | "closed" | "all">("open");

const state_ = reactive<{
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
}>({ loading: false });

const parsed = computed(() => splitSlug(slug.value));

const needsRepo = computed(() => operation.value !== "user" && operation.value !== "platforms");

const toolName = computed(() => {
  switch (operation.value) {
    case "repo":
      return "forges_repos_get";
    case "issues":
      return "forges_issues_list";
    case "pulls":
      return "forges_pull_requests_list";
    case "commits":
      return "forges_commits_list";
    case "ci":
      return "forges_ci_runs_list";
    case "threads":
      return "forges_threads_list";
    case "user":
      return "forges_users_get";
    default:
      return "forges_users_authenticated";
  }
});

/** The tool call an agent would make for the same answer; copyable as JSON. */
const toolCall = computed(() => {
  const args: Record<string, unknown> = { platform: platform.value };
  if (platform.value === "gitea" && giteaHost.value !== "gitea.com") {
    args.note = `FORGES_GITEA_BASE_URL=https://${giteaHost.value} on the agent`;
  }
  if (needsRepo.value && parsed.value) {
    args.owner = parsed.value.owner;
    args.repo = parsed.value.repo;
  }
  if (operation.value === "issues" || operation.value === "pulls") {
    args.state = state.value;
  }
  if (operation.value === "threads" && number.value !== "") {
    args.number = number.value;
  }
  if (operation.value === "user") {
    args.username = username.value.trim();
  }
  return JSON.stringify({ tool: toolName.value, arguments: args });
});

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const data = error as {
      statusCode?: number;
      statusMessage?: string;
      data?: { statusMessage?: string };
      message?: string;
    };
    const message = data.data?.statusMessage ?? data.statusMessage ?? data.message;
    if (message) {
      return data.statusCode ? `${data.statusCode}: ${message}` : message;
    }
  }
  return String(error);
}

function currentQuery(): Record<string, string> {
  const base: Record<string, string> = { op: operation.value, platform: platform.value };
  if (platform.value === "gitea" && needsRepo.value) {
    base.host = giteaHost.value;
  }
  if (needsRepo.value) {
    base.repo = slug.value.trim();
  }
  if (operation.value === "issues" || operation.value === "pulls") {
    base.state = state.value;
  }
  if (operation.value === "threads" && number.value !== "") {
    base.number = String(number.value);
  }
  if (operation.value === "user") {
    base.username = username.value.trim();
  }
  return base;
}

async function run(op: Operation = operation.value) {
  operation.value = op;
  state_.loading = true;
  state_.error = undefined;
  await router.replace({ query: currentQuery() });
  /** The stripped prerender address is not rewritten by a replace to an identical route. */
  if (import.meta.client && window.location.pathname + window.location.search !== route.fullPath) {
    window.history.replaceState(window.history.state, "", route.fullPath);
  }
  try {
    if (op === "platforms") {
      if (!state_.platforms) {
        state_.platforms = await $fetch<PlatformsAnswer>("/api/platforms", { retry: 0 });
      }
      return;
    }
    if (op === "user") {
      state_.user = await $fetch<UserAnswer>("/api/user", {
        query: { platform: platform.value, username: username.value.trim() },
        retry: 0,
      });
      return;
    }
    const target = parsed.value;
    if (!target) {
      state_.error = "Type the repository as owner/name.";
      return;
    }
    const query = {
      platform: platform.value,
      owner: target.owner,
      repo: target.repo,
      ...(platform.value === "gitea" && giteaHost.value !== "gitea.com"
        ? { host: giteaHost.value }
        : {}),
    };
    if (op === "repo") {
      state_.repo = await $fetch<RepoAnswer>("/api/repo", { query, retry: 0 });
    } else if (op === "issues") {
      state_.issues = await $fetch<PageAnswer<WireIssue>>("/api/issues", {
        query: { ...query, state: state.value, perPage: 10 },
        retry: 0,
      });
    } else if (op === "pulls") {
      state_.pulls = await $fetch<PageAnswer<WirePullRequest>>("/api/pulls", {
        query: { ...query, state: state.value, perPage: 10 },
        retry: 0,
      });
    } else if (op === "commits") {
      state_.commits = await $fetch<PageAnswer<WireCommit>>("/api/commits", {
        query: { ...query, perPage: 10 },
        retry: 0,
      });
    } else if (op === "ci") {
      state_.ci = await $fetch<PageAnswer<WireCiRun>>("/api/ci", {
        query: { ...query, perPage: 10 },
        retry: 0,
      });
    } else if (op === "threads") {
      if (number.value === "") {
        state_.error = "Threads need a pull request number.";
        return;
      }
      state_.threads = await $fetch<ThreadsAnswer>("/api/threads", {
        query: { ...query, number: number.value, perPage: 5 },
        retry: 0,
      });
    }
  } catch (error) {
    state_.error = errorText(error);
  } finally {
    state_.loading = false;
  }
}

function pickExample(example: (typeof EXAMPLES)[number]) {
  platform.value = example.platform;
  if (example.host) {
    giteaHost.value = example.host;
  }
  slug.value = example.slug;
  void run(
    operation.value === "user" || operation.value === "platforms" ? "repo" : operation.value,
  );
}

function openThreads(pr: WirePullRequest) {
  number.value = pr.number;
  void run("threads");
}

const copied = ref(false);

async function copyCall() {
  try {
    await navigator.clipboard.writeText(toolCall.value);
  } catch {
    return;
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1200);
}

function conclusionClass(conclusion: string | null, status: string): string {
  if (status !== "completed") return "forges-state-warn";
  if (conclusion === "success") return "forges-state-ok";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure")
    return "forges-state-failed";
  return "";
}

function prState(pr: WirePullRequest): string {
  if (pr.merged) return "merged";
  if (pr.draft) return "draft";
  return pr.state;
}

/** Deep link and first run happen after mount, once the router has restored the address a prerendered page lost. */
const applied = ref(false);

function apply(params: Readonly<Record<string, unknown>>) {
  applied.value = true;
  const op =
    typeof params.op === "string" && OPERATIONS.some((row) => row.key === params.op)
      ? (params.op as Operation)
      : "repo";
  if (
    typeof params.platform === "string" &&
    PROVIDER_PLATFORMS.some((row) => row.key === params.platform)
  ) {
    platform.value = params.platform;
  }
  if (typeof params.repo === "string" && params.repo) {
    slug.value = params.repo;
  }
  if (typeof params.host === "string" && GITEA_HOSTS.some((row) => row === params.host)) {
    giteaHost.value = params.host;
  }
  if (typeof params.username === "string" && params.username) {
    username.value = params.username;
  }
  if (params.state === "open" || params.state === "closed" || params.state === "all") {
    state.value = params.state;
  }
  if (
    typeof params.number === "string" &&
    Number.isInteger(Number(params.number)) &&
    Number(params.number) > 0
  ) {
    number.value = Number(params.number);
  }
  void run(op);
}

onMounted(() => {
  if (!applied.value) {
    apply(route.query);
  }
});
</script>

<template>
  <div class="space-y-5">
    <nav aria-label="Operation" class="forges-explorer-nav !mt-0 !justify-start">
      <button
        v-for="op in OPERATIONS"
        :key="op.key"
        type="button"
        class="forges-explorer-link"
        :class="{ 'forges-explorer-link-active': operation === op.key }"
        @click="run(op.key)"
      >
        <UIcon :name="op.icon" class="size-3.5" />
        {{ op.label }}
      </button>
    </nav>

    <form
      v-if="operation !== 'platforms'"
      class="forges-frame overflow-hidden rounded-xl"
      @submit.prevent="run()"
    >
      <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <select v-model="platform" class="forges-field sm:w-36" aria-label="Platform">
          <option v-for="row in PROVIDER_PLATFORMS" :key="row.key" :value="row.key">
            {{ row.label }}
          </option>
        </select>
        <select
          v-if="platform === 'gitea' && needsRepo"
          v-model="giteaHost"
          class="forges-field sm:w-40"
          aria-label="Gitea host"
        >
          <option v-for="row in GITEA_HOSTS" :key="row" :value="row">{{ row }}</option>
        </select>
        <template v-if="needsRepo">
          <label class="sr-only" for="explorer-repo">Repository</label>
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <UIcon name="i-lucide-folder-git-2" class="size-4 shrink-0 text-primary" />
            <input
              id="explorer-repo"
              v-model="slug"
              class="forges-field font-mono"
              placeholder="owner/repo"
              spellcheck="false"
              autocomplete="off"
              maxlength="200"
            />
          </div>
        </template>
        <template v-else>
          <label class="sr-only" for="explorer-user">Username</label>
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <UIcon name="i-lucide-user" class="size-4 shrink-0 text-primary" />
            <input
              id="explorer-user"
              v-model="username"
              class="forges-field font-mono"
              placeholder="username"
              spellcheck="false"
              autocomplete="off"
              maxlength="100"
            />
          </div>
        </template>
        <select
          v-if="operation === 'issues' || operation === 'pulls'"
          v-model="state"
          class="forges-field sm:w-28"
          aria-label="State"
        >
          <option value="open">open</option>
          <option value="closed">closed</option>
          <option value="all">all</option>
        </select>
        <input
          v-if="operation === 'threads'"
          v-model.number="number"
          type="number"
          min="1"
          class="forges-field font-mono sm:w-28"
          placeholder="PR #"
          aria-label="Pull request number"
        />
        <button type="submit" class="forges-btn forges-primary-fill" :disabled="state_.loading">
          <UIcon v-if="state_.loading" name="i-lucide-loader-circle" class="size-4 animate-spin" />
          <UIcon
            v-else
            :name="OPERATIONS.find((row) => row.key === operation)?.icon ?? 'i-lucide-search-code'"
            class="size-4"
          />
          {{ OPERATIONS.find((row) => row.key === operation)?.call }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 border-t border-muted px-4 py-3">
        <span class="me-1 font-mono text-[11px] text-dimmed">try</span>
        <button
          v-for="example in EXAMPLES"
          :key="example.slug"
          type="button"
          class="forges-copy"
          @click="pickExample(example)"
        >
          <UIcon :name="platformIcon(example.platform)" class="size-3.5" />
          {{ example.slug }}
        </button>
        <button
          type="button"
          class="forges-copy ms-auto"
          :aria-label="copied ? 'Copied' : 'Copy tool call'"
          @click="copyCall"
        >
          <span class="text-dimmed">tool</span> {{ clip(toolCall, 64) }}
          <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5" />
        </button>
      </div>
    </form>

    <p
      v-if="state_.loading"
      class="forges-frame flex items-center gap-2 rounded-xl px-5 py-4 text-sm text-muted"
    >
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      Asking {{ platformLabel(platform) }}…
    </p>
    <pre
      v-else-if="state_.error"
      class="forges-body forges-frame rounded-xl"
      :style="{ color: 'var(--forges-del)' }"
      >{{ state_.error }}</pre
    >

    <div
      v-else-if="operation === 'repo' && state_.repo"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <UIcon :name="platformIcon(state_.repo.platform)" class="size-4 text-primary" />
        <a
          :href="state_.repo.repository.url"
          target="_blank"
          rel="noopener nofollow"
          class="text-sm font-medium text-highlighted hover:text-primary"
          >{{ state_.repo.repository.fullName }}</a
        >
        <span
          class="forges-state"
          :class="state_.repo.repository.private ? '' : 'forges-state-ok'"
          >{{ state_.repo.repository.private ? "private" : "public" }}</span
        >
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.repo.fetchedAt) }}</span
        >
      </div>
      <p
        v-if="state_.repo.repository.description"
        class="border-b border-muted px-4 py-3 text-sm text-muted"
      >
        {{ plainText(state_.repo.repository.description) }}
      </p>
      <dl class="forges-kv">
        <dt>id</dt>
        <dd class="font-mono text-[13px]">"{{ state_.repo.repository.id }}"</dd>
        <dt>defaultBranch</dt>
        <dd class="font-mono text-[13px]">{{ state_.repo.repository.defaultBranch }}</dd>
        <dt>isFork</dt>
        <dd class="font-mono text-[13px]">{{ state_.repo.repository.isFork }}</dd>
        <dt>parent</dt>
        <dd class="font-mono text-[13px]">
          {{ state_.repo.repository.parent?.fullName ?? "null" }}
        </dd>
        <dt>cloneUrl</dt>
        <dd class="font-mono text-[13px]">{{ state_.repo.repository.cloneUrl }}</dd>
        <dt>owner</dt>
        <dd class="font-mono text-[13px]">{{ state_.repo.repository.owner.login }}</dd>
      </dl>
    </div>

    <div
      v-else-if="operation === 'issues' && state_.issues"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="text-sm font-medium text-highlighted"
          >{{ pluralize(state_.issues.items.length, "issue") }} on this page</span
        >
        <span class="font-mono text-[11px] text-dimmed"
          >state {{ state }} · hasNextPage {{ state_.issues.hasNextPage
          }}{{
            state_.issues.totalCount != null ? ` · totalCount ${state_.issues.totalCount}` : ""
          }}</span
        >
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.issues.fetchedAt) }}</span
        >
      </div>
      <p v-if="!state_.issues.items.length" class="px-4 py-4 text-sm text-muted">
        No issues in that state.
      </p>
      <ol class="divide-y divide-muted">
        <li
          v-for="issue in state_.issues.items"
          :key="issue.number"
          class="flex items-start gap-3 px-4 py-3"
        >
          <UIcon
            name="i-lucide-circle-dot"
            class="mt-0.5 size-4 shrink-0"
            :class="issue.state === 'open' ? 'text-primary' : 'text-dimmed'"
          />
          <div class="min-w-0 flex-1">
            <a
              :href="issue.url"
              target="_blank"
              rel="noopener nofollow"
              class="block truncate text-sm font-medium text-highlighted hover:text-primary"
            >
              <span class="me-1.5 font-mono text-[11px] text-dimmed">#{{ issue.number }}</span
              >{{ plainText(issue.title) }}
            </a>
            <p class="mt-0.5 font-mono text-[11px] text-dimmed">
              {{ issue.author }} · {{ dateOnly(issue.createdAt)
              }}{{ issue.assignees.length ? ` · assigned ${issue.assignees.join(", ")}` : "" }}
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
          <span class="forges-state" :class="issue.state === 'open' ? 'forges-state-ok' : ''">{{
            issue.state
          }}</span>
        </li>
      </ol>
    </div>

    <div
      v-else-if="operation === 'pulls' && state_.pulls"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="text-sm font-medium text-highlighted"
          >{{ pluralize(state_.pulls.items.length, "pull request") }} on this page</span
        >
        <span class="font-mono text-[11px] text-dimmed"
          >state {{ state }} · hasNextPage {{ state_.pulls.hasNextPage }}</span
        >
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.pulls.fetchedAt) }}</span
        >
      </div>
      <p v-if="!state_.pulls.items.length" class="px-4 py-4 text-sm text-muted">
        No pull requests in that state.
      </p>
      <ol class="divide-y divide-muted">
        <li
          v-for="pr in state_.pulls.items"
          :key="pr.number"
          class="flex items-start gap-3 px-4 py-3"
        >
          <UIcon
            name="i-lucide-git-pull-request"
            class="mt-0.5 size-4 shrink-0"
            :class="pr.draft ? 'text-dimmed' : 'text-primary'"
          />
          <div class="min-w-0 flex-1">
            <a
              :href="pr.url"
              target="_blank"
              rel="noopener nofollow"
              class="block truncate text-sm font-medium text-highlighted hover:text-primary"
            >
              <span class="me-1.5 font-mono text-[11px] text-dimmed">#{{ pr.number }}</span
              >{{ plainText(pr.title) }}
            </a>
            <p class="mt-0.5 truncate font-mono text-[11px] text-dimmed">
              <span class="text-primary">{{ pr.sourceBranch }}</span> → {{ pr.targetBranch }} ·
              {{ shortSha(pr.headSha) }} · {{ pr.author }} · {{ dateOnly(pr.createdAt) }} ·
              mergeable {{ pr.mergeable === null ? "null" : pr.mergeable
              }}{{ pr.mergeStatus ? ` (${pr.mergeStatus})` : "" }}
            </p>
          </div>
          <button type="button" class="forges-copy" @click="openThreads(pr)">
            <UIcon name="i-lucide-messages-square" class="size-3.5" /> threads
          </button>
          <span
            class="forges-state"
            :class="{
              'forges-state-ok': prState(pr) === 'open',
              'forges-state-warn': prState(pr) === 'draft',
            }"
            >{{ prState(pr) }}</span
          >
        </li>
      </ol>
    </div>

    <div
      v-else-if="operation === 'commits' && state_.commits"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="text-sm font-medium text-highlighted"
          >{{ pluralize(state_.commits.items.length, "commit") }} on this page</span
        >
        <span class="font-mono text-[11px] text-dimmed"
          >default branch · hasNextPage {{ state_.commits.hasNextPage }}</span
        >
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.commits.fetchedAt) }}</span
        >
      </div>
      <ol class="divide-y divide-muted">
        <li
          v-for="commit in state_.commits.items"
          :key="commit.sha"
          class="flex items-start gap-3 px-4 py-3"
        >
          <UIcon
            name="i-lucide-git-commit-horizontal"
            class="mt-0.5 size-4 shrink-0 text-primary"
          />
          <div class="min-w-0 flex-1">
            <a
              :href="commit.url"
              target="_blank"
              rel="noopener nofollow"
              class="block truncate text-sm text-highlighted hover:text-primary"
              >{{ commit.message }}</a
            >
            <p class="mt-0.5 font-mono text-[11px] text-dimmed">
              <span class="text-primary">{{ shortSha(commit.sha) }}</span> ·
              {{ commit.author.name }} · {{ dateOnly(commit.author.date)
              }}{{ commit.parents > 1 ? " · merge" : "" }}
            </p>
          </div>
        </li>
      </ol>
    </div>

    <div
      v-else-if="operation === 'ci' && state_.ci"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="text-sm font-medium text-highlighted"
          >{{ pluralize(state_.ci.items.length, "CI run") }} on this page</span
        >
        <span class="font-mono text-[11px] text-dimmed"
          >hasNextPage {{ state_.ci.hasNextPage }}</span
        >
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.ci.fetchedAt) }}</span
        >
      </div>
      <p v-if="!state_.ci.items.length" class="px-4 py-4 text-sm text-muted">
        No CI runs reported.
      </p>
      <div v-else class="forges-table-wrap">
        <table class="forges-table">
          <thead>
            <tr>
              <th>branch</th>
              <th>revision</th>
              <th>status</th>
              <th>conclusion</th>
              <th>id</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in state_.ci.items" :key="run.id">
              <td class="font-mono text-xs text-highlighted">{{ run.branch }}</td>
              <td class="font-mono text-xs text-muted">
                <a
                  :href="run.url"
                  target="_blank"
                  rel="noopener nofollow"
                  class="hover:text-primary"
                  >{{ shortSha(run.revision) }}</a
                >
              </td>
              <td class="font-mono text-xs text-muted">{{ run.status }}</td>
              <td>
                <span class="forges-state" :class="conclusionClass(run.conclusion, run.status)">{{
                  run.conclusion ?? "null"
                }}</span>
              </td>
              <td class="font-mono text-xs text-dimmed">{{ run.id }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-else-if="operation === 'threads' && state_.threads"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="text-sm font-medium text-highlighted"
          >{{ pluralize(state_.threads.items.length, "thread") }} on #{{
            state_.threads.number
          }}</span
        >
        <span class="font-mono text-[11px] text-dimmed"
          >state all · hasNextPage {{ state_.threads.hasNextPage }}</span
        >
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.threads.fetchedAt) }}</span
        >
      </div>
      <p v-if="!state_.threads.items.length" class="px-4 py-4 text-sm text-muted">
        No review threads on that pull request.
      </p>
      <ol class="divide-y divide-muted">
        <li v-for="thread in state_.threads.items" :key="thread.id" class="px-4 py-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-messages-square" class="size-4 shrink-0 text-primary" />
            <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-highlighted"
              >{{ thread.path
              }}<span v-if="thread.line !== null" class="text-dimmed"
                >:{{ thread.line }}</span
              ></span
            >
            <span class="font-mono text-[11px] text-dimmed">{{ clip(thread.id, 24) }}</span>
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
                {{ comment.author }} · {{ dateOnly(comment.createdAt) }}
              </p>
              <p class="mt-0.5 text-[13px] leading-5 text-muted">{{ plainText(comment.body) }}</p>
            </li>
          </ul>
        </li>
      </ol>
    </div>

    <div
      v-else-if="operation === 'user' && state_.user"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <UIcon :name="platformIcon(state_.user.platform)" class="size-4 text-primary" />
        <a
          :href="state_.user.user.url"
          target="_blank"
          rel="noopener nofollow"
          class="text-sm font-medium text-highlighted hover:text-primary"
          >{{ state_.user.user.login }}</a
        >
        <span class="text-sm text-muted">{{ state_.user.user.name }}</span>
        <span class="ms-auto font-mono text-[11px] text-dimmed"
          >fetched {{ dateOnly(state_.user.fetchedAt) }}</span
        >
      </div>
      <p v-if="state_.user.user.bio" class="border-b border-muted px-4 py-3 text-sm text-muted">
        {{ plainText(state_.user.user.bio) }}
      </p>
      <dl class="forges-kv">
        <dt>id</dt>
        <dd class="font-mono text-[13px]">"{{ state_.user.user.id }}"</dd>
        <dt>company</dt>
        <dd>{{ state_.user.user.company || "empty string" }}</dd>
        <dt>location</dt>
        <dd>{{ state_.user.user.location || "empty string" }}</dd>
        <dt>website</dt>
        <dd class="font-mono text-[13px]">
          {{ state_.user.user.website ? hostPath(state_.user.user.website) : "empty string" }}
        </dd>
        <dt>followers</dt>
        <dd class="font-mono text-[13px]">
          {{ state_.user.user.followers }} · following {{ state_.user.user.following }}
        </dd>
        <dt>createdAt</dt>
        <dd class="font-mono text-[13px]">
          {{ dateOnly(state_.user.user.createdAt) || "empty string" }}
        </dd>
      </dl>
    </div>

    <div
      v-else-if="operation === 'platforms' && state_.platforms"
      class="forges-frame overflow-hidden rounded-xl"
    >
      <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
        <p class="font-mono text-xs text-muted">
          the docs worker · @agntn/forges {{ state_.platforms.version }}
        </p>
        <p class="font-mono text-[11px] text-dimmed">
          authenticated means the worker holds a token
        </p>
      </div>
      <div class="forges-table-wrap">
        <table class="forges-table">
          <thead>
            <tr>
              <th>platform</th>
              <th>host</th>
              <th>reads</th>
              <th>threads</th>
              <th>code search</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in state_.platforms.platforms" :key="row.platform">
              <td>
                <NuxtLink
                  :to="PROVIDER_PLATFORMS.find((p) => p.key === row.platform)?.to ?? '/platforms'"
                  class="inline-flex items-center gap-2 text-sm text-highlighted hover:text-primary"
                >
                  <UIcon :name="platformIcon(row.platform)" class="size-4 text-muted" />
                  {{ platformLabel(row.platform) }}
                </NuxtLink>
              </td>
              <td class="font-mono text-xs text-muted">{{ row.host }}</td>
              <td>
                <span class="forges-state" :class="row.authenticated ? 'forges-state-ok' : ''">{{
                  row.authenticated ? "authenticated" : "anonymous"
                }}</span>
              </td>
              <td class="font-mono text-xs text-muted">
                {{ row.platform === "gitea" ? "yes" : row.authenticated ? "yes" : "need a token" }}
              </td>
              <td class="font-mono text-xs text-muted">
                {{
                  row.platform === "gitea"
                    ? "unsupported"
                    : row.platform === "gitlab"
                      ? "token, Premium for global"
                      : "yes"
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
