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
} from "../../utils/explorer";
import { OPERATIONS } from "../../utils/explorer";
import { splitSlug } from "../../utils/format";
import { EXPLORER_PLATFORMS, platformIcon } from "../../utils/platforms";
import { jsonTokens, tokens } from "../../utils/tokens";

const EXAMPLES = [
  { platform: "github", host: "", slug: "nitrojs/nitro" },
  { platform: "gitlab", host: "", slug: "gitlab-org/cli" },
  { platform: "gitea", host: "codeberg.org", slug: "forgejo/forgejo" },
] as const;

/** Hosts the worker will talk to for Gitea. Anything else needs FORGES_GITEA_BASE_URL on the worker. */
const GITEA_HOSTS = ["gitea.com", "codeberg.org"] as const;

const PLATFORM_ITEMS = EXPLORER_PLATFORMS.map((row) => ({
  label: row.label,
  value: row.key,
  icon: row.icon,
}));
const HOST_ITEMS = GITEA_HOSTS.map((host) => ({ label: host, value: host }));
const STATE_ITEMS = (["open", "closed", "all"] as const).map((value) => ({ label: value, value }));

const router = useRouter();
const route = useRoute();
const { copied, copy } = useCopied();

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

const current = computed(() => OPERATIONS.find((row) => row.key === operation.value)!);
const position = computed(() => OPERATIONS.findIndex((row) => row.key === operation.value) + 1);
const parsed = computed(() => splitSlug(slug.value));
const needsRepo = computed(() => operation.value !== "user" && operation.value !== "platforms");
const needsState = computed(() => operation.value === "issues" || operation.value === "pulls");

/** The library call for the same answer, as a script would write it. */
const libraryCall = computed(() => {
  const owner = parsed.value?.owner ?? "owner";
  const repo = parsed.value?.repo ?? "repo";
  const target = `"${owner}", "${repo}"`;
  switch (operation.value) {
    case "repo":
      return `await forge.repos.get(${target});`;
    case "issues":
      return `await forge.issues.list(${target}, { state: "${state.value}", perPage: 10 });`;
    case "pulls":
      return `await forge.pullRequests.list(${target}, { state: "${state.value}", perPage: 10 });`;
    case "commits":
      return `await forge.commits.list(${target}, { perPage: 10 });`;
    case "ci":
      return `await forge.ciRuns.list(${target}, { perPage: 10 });`;
    case "threads":
      return `await forge.threads.list(${target}, ${number.value === "" ? "number" : number.value}, { perPage: 5 });`;
    case "user":
      return `await forge.users.get("${username.value.trim()}");`;
    default:
      return "";
  }
});

/** The worker's own view has no library call behind it; locally the same question is resolveToken. */
const libraryLines = computed(() => {
  if (operation.value === "platforms") {
    return [
      'import { resolveToken } from "@agntn/forges";',
      `resolveToken("${platform.value}")?.source;  // "explicit", "env", "cli", "config" or undefined`,
    ];
  }
  const options =
    platform.value === "gitea" && giteaHost.value !== "gitea.com"
      ? `, { baseURL: "https://${giteaHost.value}" }`
      : "";
  return [`const forge = await createProvider("${platform.value}"${options});`, libraryCall.value];
});

/** The short form of the call for the bars: operation and target, no options. */
const call = computed(() => {
  if (operation.value === "platforms") return "GET /api/platforms";
  if (operation.value === "user") return `users.get("${username.value.trim()}")`;
  const target = `"${slug.value.trim()}"`;
  if (operation.value === "threads") {
    return `threads.list(${target}, ${number.value === "" ? "n" : number.value})`;
  }
  return `${current.value.call}(${target})`;
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
  if (needsState.value) {
    args.state = state.value;
  }
  if (operation.value === "threads" && number.value !== "") {
    args.number = number.value;
  }
  if (operation.value === "user") {
    args.username = username.value.trim();
  }
  return JSON.stringify({ tool: current.value.tool, arguments: args }, null, 2);
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
  if (needsState.value) {
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

const permalink = computed(() => ({ path: "/explorer", query: currentQuery() }));

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
    EXPLORER_PLATFORMS.some((row) => row.key === params.platform)
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
  <div class="explorer">
    <form class="tool-console console-wide" @submit.prevent="run()">
      <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
      <span class="console-cross console-cross-br" aria-hidden="true">+</span>
      <header class="console-bar">
        <span class="console-title"
          ><span class="console-tag">Call</span>{{ current.call
          }}<span class="console-file"
            >{{ String(position).padStart(2, "0") }} /
            {{ String(OPERATIONS.length).padStart(2, "0") }}</span
          ></span
        >
        <span class="console-meta">docs worker · cached</span>
        <span class="console-mark" aria-hidden="true" />
      </header>
      <div class="console-ruler" aria-hidden="true">
        <span :key="operation" class="console-cursor" />
      </div>

      <div class="console-band explorer-band-first explorer-columns">
        <div class="explorer-column">
          <p class="console-label console-rule-title">
            <span
              >Operation <span aria-hidden="true">[ {{ OPERATIONS.length }} ]</span></span
            >
            <span class="console-mark" aria-hidden="true" />
          </p>
          <div role="group" aria-label="Operation" class="explorer-ops console-draw">
            <button
              v-for="(row, index) in OPERATIONS"
              :key="row.key"
              type="button"
              class="console-lead"
              :aria-pressed="operation === row.key"
              @click="run(row.key)"
            >
              <span class="console-tag">{{ row.tag }}</span>
              <span>{{ row.call }}</span>
              <span
                class="console-leader"
                aria-hidden="true"
                :style="{ animationDelay: `${index * 60}ms` }"
              />
            </button>
          </div>
          <p class="console-about explorer-about">{{ current.about }}</p>
        </div>

        <div class="explorer-column">
          <p class="console-label console-rule-title">
            <span>Input <span aria-hidden="true">[ every field is in the link ]</span></span>
            <span class="console-mark" aria-hidden="true" />
          </p>

          <div class="console-readout">
            <dl class="console-readout-rows">
              <div v-if="operation !== 'platforms'">
                <dt><label for="explorer-platform">platform</label></dt>
                <dd>
                  <USelectMenu
                    id="explorer-platform"
                    v-model="platform"
                    :items="PLATFORM_ITEMS"
                    value-key="value"
                    variant="none"
                    :icon="platformIcon(platform)"
                    :search-input="false"
                    class="w-full"
                  />
                </dd>
              </div>
              <div v-if="platform === 'gitea' && needsRepo">
                <dt><label for="explorer-host">host</label></dt>
                <dd>
                  <USelectMenu
                    id="explorer-host"
                    v-model="giteaHost"
                    :items="HOST_ITEMS"
                    value-key="value"
                    variant="none"
                    :search-input="false"
                    class="w-full"
                  />
                </dd>
              </div>
              <div v-if="needsRepo">
                <dt><label for="explorer-repo">repo</label></dt>
                <dd>
                  <UInput
                    id="explorer-repo"
                    v-model="slug"
                    variant="none"
                    placeholder="owner/repo"
                    spellcheck="false"
                    autocomplete="off"
                    maxlength="200"
                    class="w-full"
                  />
                </dd>
              </div>
              <div v-if="operation === 'user'">
                <dt><label for="explorer-user">username</label></dt>
                <dd>
                  <UInput
                    id="explorer-user"
                    v-model="username"
                    variant="none"
                    placeholder="username"
                    spellcheck="false"
                    autocomplete="off"
                    maxlength="100"
                    class="w-full"
                  />
                </dd>
              </div>
              <div v-if="needsState">
                <dt><label for="explorer-state">state</label></dt>
                <dd>
                  <USelectMenu
                    id="explorer-state"
                    v-model="state"
                    :items="STATE_ITEMS"
                    value-key="value"
                    variant="none"
                    :search-input="false"
                    class="w-full"
                  />
                </dd>
              </div>
              <div v-if="operation === 'threads'">
                <dt><label for="explorer-number">number</label></dt>
                <dd>
                  <UInput
                    id="explorer-number"
                    v-model.number="number"
                    variant="none"
                    type="number"
                    min="1"
                    placeholder="pull request number"
                    class="w-full"
                  />
                </dd>
              </div>
              <div v-if="operation === 'platforms'">
                <dt>input</dt>
                <dd class="explorer-none">none, the worker answers for itself</dd>
              </div>
            </dl>
          </div>

          <div class="explorer-actions">
            <UButton
              type="submit"
              color="primary"
              variant="solid"
              :loading="state_.loading"
              trailing-icon="i-lucide-arrow-right"
              :label="`Run ${current.call}`"
            />
          </div>

          <div class="explorer-chips" role="group" aria-label="Sample repositories">
            <UButton
              v-for="example in EXAMPLES"
              :key="example.slug"
              :color="needsRepo && slug === example.slug ? 'primary' : 'neutral'"
              variant="chip"
              :icon="platformIcon(example.platform)"
              :label="example.slug"
              :aria-pressed="needsRepo && slug === example.slug"
              @click="pickExample(example)"
            />
          </div>
        </div>
      </div>

      <div class="console-band explorer-columns">
        <div class="explorer-column">
          <p class="console-label console-rule-title">
            <span>Library <span aria-hidden="true">[ same call in a script ]</span></span>
            <span class="console-mark" aria-hidden="true" />
            <UButton
              color="neutral"
              variant="subtle"
              :icon="copied === 'library' ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copied === 'library' ? 'copied' : 'copy'"
              :aria-label="copied === 'library' ? 'Copied' : 'Copy the library call'"
              @click="copy('library', libraryLines.join('\n'))"
            />
          </p>
          <!-- prettier-ignore -->
          <pre class="console-snippet"><code><span v-for="(line, index) in libraryLines" :key="index" class="explorer-line"><span v-for="(token, part) in tokens(line)" :key="part" :class="token.cls">{{ token.text }}</span></span></code></pre>
        </div>
        <div class="explorer-column">
          <p class="console-label console-rule-title">
            <span>Tool <span aria-hidden="true">[ what an MCP client sends ]</span></span>
            <span class="console-mark" aria-hidden="true" />
            <UButton
              color="neutral"
              variant="subtle"
              :icon="copied === 'tool' ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copied === 'tool' ? 'copied' : 'copy'"
              :aria-label="copied === 'tool' ? 'Copied' : 'Copy the tool call'"
              @click="copy('tool', toolCall)"
            />
          </p>
          <!-- prettier-ignore -->
          <pre class="console-snippet"><code><span v-for="(token, index) in jsonTokens(toolCall)" :key="index" :class="token.cls">{{ token.text }}</span></code></pre>
        </div>
      </div>

      <footer class="console-footer console-footer-plain">
        <NuxtLink :to="permalink" class="explorer-permalink"
          ><span aria-hidden="true">→ </span>permalink</NuxtLink
        >
        <span class="console-meta">every state is a link</span>
      </footer>
    </form>

    <!-- The call runs from the request down into the answer. -->
    <div class="explorer-link" aria-hidden="true">
      <svg :key="call" class="hero-circuit" viewBox="0 0 160 56">
        <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
        <path class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
        <path class="hero-circuit-seg" d="M96 38V48" />
        <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
      </svg>
      <span class="hero-circuit-tag">answer</span>
    </div>

    <ExplorerAnswer
      :operation="operation"
      :platform="platform"
      :call="call"
      :loading="state_.loading"
      :error="state_.error"
      :repo="state_.repo"
      :issues="state_.issues"
      :pulls="state_.pulls"
      :commits="state_.commits"
      :ci="state_.ci"
      :threads="state_.threads"
      :user="state_.user"
      :platforms="state_.platforms"
      @threads="openThreads"
    />
  </div>
</template>

<style scoped>
.explorer {
  text-align: left;
}
.explorer-link {
  position: relative;
  height: 56px;
}
.explorer-link > .hero-circuit {
  bottom: 0;
}
.explorer-link > .hero-circuit-tag {
  bottom: 18px;
}
/* One track by default: an implicit auto track would grow to the widest chip row and push the page sideways. */
.explorer-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px 48px;
}
.explorer-column {
  min-width: 0;
}
@media (width >= 56rem) {
  .explorer-columns {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
@media (width >= 80rem) {
  .explorer-ops {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
/* The explorer carries more rows than a dossier, so its bands breathe a little wider. */
.explorer :deep(.console-band) {
  padding: 22px 24px 24px;
}
.explorer :deep(.console-rule-title) {
  margin-bottom: 18px;
}
.explorer :deep(.console-readout-rows > div) {
  grid-template-columns: 6.5rem minmax(0, 1fr);
  padding: 12px 16px;
}
.explorer :deep(.console-readout-rows dt) {
  text-transform: none;
  letter-spacing: 0.02em;
}
.explorer :deep(.console-footer) {
  padding: 14px 24px;
}
.explorer :deep(.console-rows li) {
  padding: 12px 24px;
}
.explorer-band-first {
  border-top: 0;
}
.explorer-ops {
  display: grid;
  gap: 0 40px;
  margin-top: -12px;
}
.explorer-ops .console-lead {
  margin-top: 12px;
  padding: 2px 0;
}
.explorer-ops .console-lead > span:not(.console-tag, .console-leader) {
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.explorer-ops .console-lead[aria-pressed="true"] > span:not(.console-tag, .console-leader),
.explorer-ops .console-lead:hover > span:not(.console-tag, .console-leader) {
  color: var(--ui-text-highlighted);
}
.explorer-about {
  margin-top: 20px;
  font-size: 14px;
}
.explorer-none {
  color: var(--ui-text-dimmed) !important;
}
.explorer-actions {
  display: flex;
  margin-top: 18px;
}
.explorer-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.explorer :deep(.console-snippet) {
  padding: 12px 16px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.explorer-line {
  display: block;
}
.explorer-permalink {
  color: var(--ui-text-highlighted);
}
.explorer-permalink:hover {
  color: var(--console-accent);
}
@media (width < 640px) {
  .explorer :deep(.console-rule-title > span:first-child > span) {
    display: none;
  }
  .explorer :deep(.console-band) {
    padding: 18px 16px 20px;
  }
  .explorer :deep(.console-rows li) {
    padding: 12px 16px;
  }
}
</style>
