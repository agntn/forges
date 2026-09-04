import { LANDING_SAMPLES, type ForgeSample } from "../utils/landing-fixtures";

interface RepoAnswer {
  repository: ForgeSample["repository"];
}

interface IssuesAnswer {
  items: ForgeSample["issues"]["items"];
  hasNextPage: boolean;
  totalCount: number | null;
}

interface PullsAnswer {
  items: ForgeSample["pullRequests"]["items"];
  hasNextPage: boolean;
}

interface CommitsAnswer {
  items: ForgeSample["commits"];
}

interface CiAnswer {
  items: ForgeSample["ciRuns"];
}

interface ThreadsAnswer {
  number: number;
  items: ForgeSample["threads"]["items"];
}

function sampleKey(sample: ForgeSample): string {
  return `${sample.platform}:${sample.owner}/${sample.repo}`;
}

/** One clock for every landing panel; each recorded sample is swapped for the worker's answer once. */
export function useLandingForge() {
  const samples = ref<ForgeSample[]>([...LANDING_SAMPLES]);
  const tick = ref(0);
  const paused = ref(false);
  const index = computed(() => tick.value % samples.value.length);
  const current = computed(() => samples.value[index.value]!);

  const refreshed = new Set<string>();
  let timer: number | undefined;

  async function refresh(sample: ForgeSample) {
    const key = sampleKey(sample);
    if (refreshed.has(key)) {
      return;
    }
    refreshed.add(key);
    const query = {
      platform: sample.platform,
      owner: sample.owner,
      repo: sample.repo,
      ...(sample.baseURL ? { host: sample.host } : {}),
    };
    const settled = await Promise.allSettled([
      $fetch<RepoAnswer>("/api/repo", { query, retry: 0 }),
      $fetch<IssuesAnswer>("/api/issues", {
        query: { ...query, state: "open", perPage: 5 },
        retry: 0,
      }),
      $fetch<PullsAnswer>("/api/pulls", {
        query: { ...query, state: "open", perPage: 5 },
        retry: 0,
      }),
      $fetch<CommitsAnswer>("/api/commits", { query: { ...query, perPage: 5 }, retry: 0 }),
      $fetch<CiAnswer>("/api/ci", { query: { ...query, perPage: 5 }, retry: 0 }),
      sample.threads.number === null
        ? Promise.reject(new Error("no thread sample"))
        : $fetch<ThreadsAnswer>("/api/threads", {
            query: { ...query, number: sample.threads.number, perPage: 2 },
            retry: 0,
          }),
    ]);
    const [repo, issues, pulls, commits, ci, threads] = settled;
    const at = samples.value.findIndex((row) => sampleKey(row) === key);
    if (at === -1) {
      return;
    }
    /* A panel whose answer failed keeps its recorded sample; the others go live. */
    if (settled.every((row) => row.status === "rejected")) {
      return;
    }
    const base = samples.value[at]!;
    samples.value[at] = {
      ...base,
      ...(repo.status === "fulfilled" ? { repository: repo.value.repository } : {}),
      ...(issues.status === "fulfilled" ? { issues: issues.value } : {}),
      ...(pulls.status === "fulfilled" ? { pullRequests: pulls.value } : {}),
      ...(commits.status === "fulfilled" ? { commits: commits.value.items } : {}),
      ...(ci.status === "fulfilled" ? { ciRuns: ci.value.items } : {}),
      ...(threads.status === "fulfilled" && threads.value.items.length > 0
        ? { threads: threads.value }
        : {}),
      live: true,
    };
  }

  function step(delta: number) {
    tick.value = Math.max(0, tick.value + delta);
    void refresh(current.value);
  }

  function stopWalk() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function startWalk() {
    stopWalk();
    if (!import.meta.client || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    timer = window.setInterval(() => {
      if (!paused.value && !document.hidden) {
        step(1);
      }
    }, 4800);
  }

  onMounted(() => {
    void refresh(current.value);
    startWalk();
  });

  onUnmounted(stopWalk);

  return { samples, tick, index, paused, current, step };
}
