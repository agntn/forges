import type { CiRunConclusion, CiRunStatus, IssueState, Repository } from "@agntn/forges";

/**
 * Answers recorded through the library on 2026-09-04, so the landing has content
 * before the docs worker answers and when it cannot. Every panel labels a recorded answer
 * as a sample and swaps to a live one as soon as it arrives.
 *
 * Regenerate with the library (see docs/AGENTS.md); do not edit by hand.
 */

export type SamplePlatform = "github" | "gitlab" | "gitea";

export interface SampleIssue {
  readonly number: number;
  readonly title: string;
  readonly state: IssueState;
  readonly labels: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  readonly url: string;
}

export interface SamplePullRequest extends SampleIssue {
  readonly draft: boolean;
  readonly merged: boolean;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly headSha: string;
  readonly mergeable: boolean | null;
}

export interface SampleCommit {
  readonly sha: string;
  readonly message: string;
  readonly author: { readonly name: string; readonly date: string };
  readonly parents: number;
  readonly url: string;
}

export interface SampleCiRun {
  readonly id: string;
  readonly branch: string;
  readonly revision: string;
  readonly status: CiRunStatus;
  readonly conclusion: CiRunConclusion;
  readonly url: string;
}

export interface SampleThreadComment {
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface SampleThread {
  readonly id: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly path: string;
  readonly line: number | null;
  readonly comments: readonly SampleThreadComment[];
}

export interface ForgeSample {
  readonly platform: SamplePlatform;
  readonly owner: string;
  readonly repo: string;
  /** Custom API base, null for the platform default. */
  readonly baseURL: string | null;
  readonly host: string;
  readonly repository: Repository;
  readonly issues: {
    readonly items: readonly SampleIssue[];
    readonly hasNextPage: boolean;
    readonly totalCount: number | null;
  };
  readonly pullRequests: {
    readonly items: readonly SamplePullRequest[];
    readonly hasNextPage: boolean;
  };
  readonly commits: readonly SampleCommit[];
  readonly ciRuns: readonly SampleCiRun[];
  /** Review threads of the first open pull request that has any; number is null when none were readable. */
  readonly threads: { readonly number: number | null; readonly items: readonly SampleThread[] };
  /** Whether the answer came from the docs worker in this session. */
  readonly live: boolean;
}

export const LANDING_SAMPLES: readonly ForgeSample[] = [
  {
    platform: "github",
    owner: "nitrojs",
    repo: "nitro",
    baseURL: null,
    host: "github.com",
    repository: {
      id: "452269390",
      name: "nitro",
      fullName: "nitrojs/nitro",
      description:
        "Next Generation Server Toolkit. Create web servers with everything you need and deploy them wherever you prefer.",
      private: false,
      defaultBranch: "main",
      url: "https://github.com/nitrojs/nitro",
      cloneUrl: "https://github.com/nitrojs/nitro.git",
      isFork: false,
      parent: null,
      viewerPermission: null,
      owner: {
        login: "nitrojs",
        avatarUrl: "https://avatars.githubusercontent.com/u/183071544?v=4",
      },
    },
    issues: {
      items: [
        {
          number: 4564,
          title:
            "NOENT when loading .js server route from layer via nitro-handler-meta virtual module",
          state: "open",
          labels: ["bug", "nuxt", "v2"],
          author: "alapeta",
          createdAt: "2026-08-27T14:48:02Z",
          url: "https://github.com/nitrojs/nitro/issues/4564",
        },
        {
          number: 4555,
          title: "Default error handler throws ERR_INVALID_URL on an unparsable Host header",
          state: "open",
          labels: ["bug", "v2"],
          author: "sergiooak",
          createdAt: "2026-08-24T14:30:32Z",
          url: "https://github.com/nitrojs/nitro/issues/4555",
        },
      ],
      hasNextPage: true,
      totalCount: null,
    },
    pullRequests: {
      items: [
        {
          number: 4560,
          title: "feat(openapi): infer request and response schemas",
          state: "open",
          labels: ["enhancement", "openapi", "v3"],
          author: "abcdmku",
          createdAt: "2026-08-25T02:35:31Z",
          url: "https://github.com/nitrojs/nitro/pull/4560",
          draft: false,
          merged: false,
          sourceBranch: "feat/openapi-schema-inference",
          targetBranch: "main",
          headSha: "c6f476f0daedf54500b16033db7cbeb6cd3825be",
          mergeable: null,
        },
        {
          number: 4554,
          title: "feat(presets): add `platformatic` preset",
          state: "open",
          labels: ["enhancement", "preset", "v3"],
          author: "p-dubovitsky",
          createdAt: "2026-08-24T12:14:54Z",
          url: "https://github.com/nitrojs/nitro/pull/4554",
          draft: false,
          merged: false,
          sourceBranch: "platformatic-preset",
          targetBranch: "main",
          headSha: "9d45f870c12600033ce57c2a70f0853cf8adfb1c",
          mergeable: null,
        },
        {
          number: 4551,
          title: "fix(routing): encode non-ASCII characters in route patterns before registering",
          state: "open",
          labels: ["bug", "router", "v3"],
          author: "Vincentdevreede",
          createdAt: "2026-08-23T13:26:36Z",
          url: "https://github.com/nitrojs/nitro/pull/4551",
          draft: false,
          merged: false,
          sourceBranch: "fix/nonascii-route-encoding",
          targetBranch: "main",
          headSha: "fdea9e13248f243a0b95d6536d2212855e6047e4",
          mergeable: null,
        },
        {
          number: 4549,
          title: "fix(dev): resolve public assets dynamically in the worker",
          state: "open",
          labels: ["bug", "dev", "v3"],
          author: "meta-syntax",
          createdAt: "2026-08-22T09:07:43Z",
          url: "https://github.com/nitrojs/nitro/pull/4549",
          draft: false,
          merged: false,
          sourceBranch: "fix/dev-public-assets-internal-fetch",
          targetBranch: "main",
          headSha: "c8942ad961c678069eb7ce503b3569f4b0d86242",
          mergeable: null,
        },
        {
          number: 4519,
          title: "fix(rollup): keep import attributes in the build output",
          state: "open",
          labels: ["bug", "rollup", "v2"],
          author: "agantelin",
          createdAt: "2026-08-09T00:00:11Z",
          url: "https://github.com/nitrojs/nitro/pull/4519",
          draft: false,
          merged: false,
          sourceBranch: "fix/import-attributes",
          targetBranch: "v2",
          headSha: "a17e49415bb2d0e6639b5339ec7fc39a5395f4f0",
          mergeable: null,
        },
      ],
      hasNextPage: true,
    },
    commits: [
      {
        sha: "0509fb904ec87a0962187af13893b20cfdf2d34f",
        message: "v3.0.260903-beta",
        author: {
          name: "Pooya Parsa",
          date: "2026-09-03T22:53:04Z",
        },
        parents: 1,
        url: "https://github.com/nitrojs/nitro/commit/0509fb904ec87a0962187af13893b20cfdf2d34f",
      },
      {
        sha: "76875697dc403dbca230b83ce6acc9e8c0b6b5bc",
        message: "chore: update srvx",
        author: {
          name: "Pooya Parsa",
          date: "2026-09-03T22:50:32Z",
        },
        parents: 1,
        url: "https://github.com/nitrojs/nitro/commit/76875697dc403dbca230b83ce6acc9e8c0b6b5bc",
      },
      {
        sha: "7f05b8192d5218b00ce1a7e532b89660c48574b1",
        message: "chore: update h3",
        author: {
          name: "Pooya Parsa",
          date: "2026-09-03T22:42:59Z",
        },
        parents: 1,
        url: "https://github.com/nitrojs/nitro/commit/7f05b8192d5218b00ce1a7e532b89660c48574b1",
      },
      {
        sha: "a28ca29f2b3cfab1a7968a87dd456d1c34b03326",
        message: "fix(deps): auto-install in agent and non-tty environments",
        author: {
          name: "Pooya Parsa",
          date: "2026-09-03T22:32:44Z",
        },
        parents: 1,
        url: "https://github.com/nitrojs/nitro/commit/a28ca29f2b3cfab1a7968a87dd456d1c34b03326",
      },
      {
        sha: "8157e00b15d3a9d8dc45283b07475df0c843006c",
        message: "fix(storage, database): import connector libs from their real specifier",
        author: {
          name: "Pooya Parsa",
          date: "2026-09-03T22:30:41Z",
        },
        parents: 1,
        url: "https://github.com/nitrojs/nitro/commit/8157e00b15d3a9d8dc45283b07475df0c843006c",
      },
    ],
    ciRuns: [
      {
        id: "33831053876",
        branch: "renovate/all-minor-patch",
        revision: "d3f1a738299a955a4a6102795987cc7fd4b41dbe",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/nitrojs/nitro/actions/runs/33831053876",
      },
      {
        id: "33831053828",
        branch: "renovate/all-minor-patch",
        revision: "d3f1a738299a955a4a6102795987cc7fd4b41dbe",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/nitrojs/nitro/actions/runs/33831053828",
      },
      {
        id: "33815125395",
        branch: "v3.0.260903-beta",
        revision: "0509fb904ec87a0962187af13893b20cfdf2d34f",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/nitrojs/nitro/actions/runs/33815125395",
      },
      {
        id: "33815123303",
        branch: "main",
        revision: "0509fb904ec87a0962187af13893b20cfdf2d34f",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/nitrojs/nitro/actions/runs/33815123303",
      },
      {
        id: "33815123301",
        branch: "main",
        revision: "0509fb904ec87a0962187af13893b20cfdf2d34f",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/nitrojs/nitro/actions/runs/33815123301",
      },
    ],
    threads: {
      number: 4560,
      items: [
        {
          id: "PRRT_kwDOGvUVTs6b61j-",
          isResolved: true,
          isOutdated: false,
          path: "src/runtime/internal/openapi.ts",
          line: 57,
          comments: [
            {
              author: "coderabbitai",
              body: "_🗄️ Data Integrity & Integration_ | _🟠 Major_ | _🏗️ Heavy lift_ **Preserve recursive local references.** A self-referential local `$ref` reaches Line 55 and becomes `{}`. Lines 71…",
              createdAt: "2026-08-25T02:41:34Z",
            },
            {
              author: "abcdmku",
              body: "Fixed in ec5fa8b4. Cyclic local references are preserved, the `$defs` or `definitions` container remains in the normalized schema, and `test/unit/openapi-schema.test.ts` covers a…",
              createdAt: "2026-08-25T02:44:56Z",
            },
          ],
        },
        {
          id: "PRRT_kwDOGvUVTs6b65p_",
          isResolved: true,
          isOutdated: true,
          path: "src/runtime/internal/routes/openapi.ts",
          line: null,
          comments: [
            {
              author: "coderabbitai",
              body: "_🗄️ Data Integrity & Integration_ | _🟠 Major_ | _⚡ Quick win_ **Keep local definitions reachable from parameter schemas.** If a query or header property contains a recursive local…",
              createdAt: "2026-08-25T02:47:58Z",
            },
            {
              author: "abcdmku",
              body: "Fixed in c6f476f0. Parameter schemas now inherit the parent `$defs` or `definitions` only when they contain a local reference. The Vite fixture covers recursive query and header p…",
              createdAt: "2026-08-25T02:52:25Z",
            },
          ],
        },
      ],
    },
    live: false,
  },
  {
    platform: "gitlab",
    owner: "gitlab-org",
    repo: "cli",
    baseURL: null,
    host: "gitlab.com",
    repository: {
      id: "34675721",
      name: "cli",
      fullName: "gitlab-org/cli",
      description: "A GitLab CLI tool bringing GitLab to your command line",
      private: false,
      defaultBranch: "main",
      url: "https://gitlab.com/gitlab-org/cli",
      cloneUrl: "https://gitlab.com/gitlab-org/cli.git",
      isFork: false,
      parent: null,
      viewerPermission: null,
      owner: {
        login: "gitlab-org",
        avatarUrl: "/uploads/-/system/group/avatar/9970/project_avatar.png?v=1750616408",
      },
    },
    issues: {
      items: [
        {
          number: 8534,
          title: "Add a command to remove completed or abandoned stacks",
          state: "open",
          labels: ["automation:ml", "backend", "category:gitlab cli", "feature::addition"],
          author: "mathew.wheatley",
          createdAt: "2026-09-03T23:55:30.782Z",
          url: "https://gitlab.com/gitlab-org/cli/-/work_items/8534",
        },
        {
          number: 8533,
          title: "`repo create --skipGitInit` does not skip local Git setup",
          state: "open",
          labels: [
            "automation:quick-win",
            "automation:quick-win-judged",
            "category:gitlab cli",
            "cli command::project",
          ],
          author: "phikai",
          createdAt: "2026-09-03T20:05:29.016Z",
          url: "https://gitlab.com/gitlab-org/cli/-/work_items/8533",
        },
        {
          number: 8532,
          title: "OAuth2 token refresh ignores configured subfolder",
          state: "open",
          labels: ["automation:ml", "backend", "bug::functional", "type::bug"],
          author: "nims-fukuyama",
          createdAt: "2026-09-03T00:41:02.233Z",
          url: "https://gitlab.com/gitlab-org/cli/-/work_items/8532",
        },
        {
          number: 8531,
          title:
            "Bundled agent skill uses `:iid` as a `glab api` placeholder, which is not expanded",
          state: "open",
          labels: ["automation:ml", "backend", "bug::functional", "type::bug"],
          author: "Tyc0rc",
          createdAt: "2026-09-02T17:24:54.781Z",
          url: "https://gitlab.com/gitlab-org/cli/-/work_items/8531",
        },
        {
          number: 8530,
          title: "perf: stop fetching every page when looking up a single note or job",
          state: "open",
          labels: ["automation:ml", "backend", "category:gitlab cli", "devops::ai coding"],
          author: "phikai",
          createdAt: "2026-09-02T15:43:35.053Z",
          url: "https://gitlab.com/gitlab-org/cli/-/work_items/8530",
        },
      ],
      hasNextPage: true,
      totalCount: 397,
    },
    pullRequests: {
      items: [
        {
          number: 3848,
          title: "fix(skills): stop the bundled skill using :iid, which is not a placeholder",
          state: "open",
          labels: ["Community contribution", "linked-issue", "type::bug", "workflow::in dev"],
          author: "anbuchelvanganesan.cse2024",
          createdAt: "2026-09-04T08:15:50.276Z",
          url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3848",
          draft: false,
          merged: false,
          sourceBranch: "fix/agent-skill-iid-placeholder-8531",
          targetBranch: "main",
          headSha: "5635c7540503444202f3b02e153b334af34090a6",
          mergeable: true,
        },
        {
          number: 3847,
          title: "fix(auth): use the configured subfolder when refreshing OAuth tokens",
          state: "open",
          labels: ["Community contribution", "linked-issue", "type::bug", "workflow::in dev"],
          author: "anbuchelvanganesan.cse2024",
          createdAt: "2026-09-04T08:11:59.645Z",
          url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3847",
          draft: false,
          merged: false,
          sourceBranch: "fix/oauth-refresh-subfolder-8532",
          targetBranch: "main",
          headSha: "1bb921527aeb75ad9cb69feaf2d8301e44620c42",
          mergeable: true,
        },
        {
          number: 3846,
          title: "fix(repo): honor --skipGitInit in both create paths",
          state: "open",
          labels: [
            "Community contribution",
            "devops::ai coding",
            "group::code review",
            "linked-issue",
          ],
          author: "anbuchelvanganesan.cse2024",
          createdAt: "2026-09-04T08:06:42.613Z",
          url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3846",
          draft: false,
          merged: false,
          sourceBranch: "fix/repo-create-skip-git-init-8533",
          targetBranch: "main",
          headSha: "97e30512223bb122b2c100ac515cff60f2bcbb81",
          mergeable: true,
        },
        {
          number: 3845,
          title: "Draft: fix(security): resolve scan profile ID when disabling by name",
          state: "open",
          labels: [],
          author: "rossfuhrman",
          createdAt: "2026-09-03T19:29:50.732Z",
          url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3845",
          draft: true,
          merged: false,
          sourceBranch: "fix/security-config-disable-by-name",
          targetBranch: "main",
          headSha: "fba5cf60a851eb093b025abf41e7532670762e17",
          mergeable: true,
        },
        {
          number: 3844,
          title: "Draft: docs(security): document triage_and_remediation scan profile",
          state: "open",
          labels: [],
          author: "rossfuhrman",
          createdAt: "2026-09-03T18:57:17.231Z",
          url: "https://gitlab.com/gitlab-org/cli/-/merge_requests/3844",
          draft: true,
          merged: false,
          sourceBranch: "feat/security-config-triage-and-remediation",
          targetBranch: "main",
          headSha: "913dbc3c9d92ad378ed6975fe15f2c29c38e757c",
          mergeable: true,
        },
      ],
      hasNextPage: true,
    },
    commits: [
      {
        sha: "edfcf76d60c75d97e3fa725beec2cdb6cc6e7922",
        message: "Merge branch 'fix/mcp-serve-inherited-flags-in-tool-schema' into 'main'",
        author: {
          name: "James Hebden",
          date: "2026-09-04T17:30:03.000+10:00",
        },
        parents: 2,
        url: "https://gitlab.com/gitlab-org/cli/-/commit/edfcf76d60c75d97e3fa725beec2cdb6cc6e7922",
      },
      {
        sha: "67502ca5d9a52b24567d90ada219d4dc375fac35",
        message: "fix(mcp): advertise inherited flags in tool schemas",
        author: {
          name: "Kai Armstrong",
          date: "2026-09-04T02:30:00.000-05:00",
        },
        parents: 1,
        url: "https://gitlab.com/gitlab-org/cli/-/commit/67502ca5d9a52b24567d90ada219d4dc375fac35",
      },
      {
        sha: "3dc1097877a2c3559babeee4516be2b878dd6f91",
        message:
          "Merge branch 'renovate/github.com-docker-docker-credential-helpers-0.x' into 'main'",
        author: {
          name: "James Hebden",
          date: "2026-09-04T17:28:18.000+10:00",
        },
        parents: 2,
        url: "https://gitlab.com/gitlab-org/cli/-/commit/3dc1097877a2c3559babeee4516be2b878dd6f91",
      },
      {
        sha: "7e9eb57e2384d20a8c775e801579e904e6ca5399",
        message: "Merge branch 'feat/telemetry-coding-agent' into 'main'",
        author: {
          name: "Timo Furrer",
          date: "2026-09-04T07:57:31.000+02:00",
        },
        parents: 2,
        url: "https://gitlab.com/gitlab-org/cli/-/commit/7e9eb57e2384d20a8c775e801579e904e6ca5399",
      },
      {
        sha: "2b7bb5feee417f95814e01c30ee0a0009ed14343",
        message: "feat(telemetry): send coding agent, CLI version and platform",
        author: {
          name: "Kai Armstrong",
          date: "2026-09-04T00:57:31.000-05:00",
        },
        parents: 1,
        url: "https://gitlab.com/gitlab-org/cli/-/commit/2b7bb5feee417f95814e01c30ee0a0009ed14343",
      },
    ],
    ciRuns: [
      {
        id: "2819435876",
        branch: "main",
        revision: "edfcf76d60c75d97e3fa725beec2cdb6cc6e7922",
        status: "completed",
        conclusion: "success",
        url: "https://gitlab.com/gitlab-org/cli/-/pipelines/2819435876",
      },
      {
        id: "2819431718",
        branch: "main",
        revision: "3dc1097877a2c3559babeee4516be2b878dd6f91",
        status: "completed",
        conclusion: "success",
        url: "https://gitlab.com/gitlab-org/cli/-/pipelines/2819431718",
      },
      {
        id: "2819397945",
        branch: "refs/merge-requests/3819/train",
        revision: "f31f669a5c31edde1e6f625deecaee205c275162",
        status: "completed",
        conclusion: "success",
        url: "https://gitlab.com/gitlab-org/cli/-/pipelines/2819397945",
      },
      {
        id: "2819393326",
        branch: "refs/merge-requests/3820/train",
        revision: "ad57500e85fe1bdc1830bb217360235a431b8442",
        status: "completed",
        conclusion: "success",
        url: "https://gitlab.com/gitlab-org/cli/-/pipelines/2819393326",
      },
      {
        id: "2819234924",
        branch: "main",
        revision: "7e9eb57e2384d20a8c775e801579e904e6ca5399",
        status: "completed",
        conclusion: "success",
        url: "https://gitlab.com/gitlab-org/cli/-/pipelines/2819234924",
      },
    ],
    threads: {
      number: null,
      items: [],
    },
    live: false,
  },
  {
    platform: "gitea",
    owner: "forgejo",
    repo: "forgejo",
    baseURL: "https://codeberg.org",
    host: "codeberg.org",
    repository: {
      id: "73144",
      name: "forgejo",
      fullName: "forgejo/forgejo",
      description: "Beyond coding. We forge.",
      private: false,
      defaultBranch: "forgejo",
      url: "https://codeberg.org/forgejo/forgejo",
      cloneUrl: "https://codeberg.org/forgejo/forgejo.git",
      isFork: false,
      parent: null,
      viewerPermission: null,
      owner: {
        login: "forgejo",
        avatarUrl: "https://codeberg.org/avatars/dae8ab126a96f6fbd6942cf08ab92382",
      },
    },
    issues: {
      items: [
        {
          number: 14232,
          title: "problem: panic creating pull request with organization project selected",
          state: "open",
          labels: ["impact/unknown", "problem"],
          author: "fmv1992",
          createdAt: "2026-09-03T21:39:38+02:00",
          url: "https://codeberg.org/forgejo/forgejo/issues/14232",
        },
        {
          number: 14231,
          title:
            "problem: Collaborator with write can initially access a repo, but access later fails even though the user is still a co…",
          state: "open",
          labels: ["impact/unknown", "problem"],
          author: "readspeaker",
          createdAt: "2026-09-03T14:10:22+02:00",
          url: "https://codeberg.org/forgejo/forgejo/issues/14231",
        },
        {
          number: 14229,
          title: "problem: pull requests aren't editable by default",
          state: "open",
          labels: ["impact/unknown", "problem"],
          author: "wetneb",
          createdAt: "2026-09-03T11:25:56+02:00",
          url: "https://codeberg.org/forgejo/forgejo/issues/14229",
        },
        {
          number: 14226,
          title: "enh: Migrate GitLab 'Status' field into equivalent Forgejo scoped labels",
          state: "open",
          labels: ["enhancement/feature"],
          author: "mlncn",
          createdAt: "2026-09-03T01:51:49+02:00",
          url: "https://codeberg.org/forgejo/forgejo/issues/14226",
        },
        {
          number: 14217,
          title:
            "problem: Git clone migration fails when an HTTP Basic server returns 404 for username-only credentials",
          state: "open",
          labels: ["impact/unknown", "problem"],
          author: "pmnmqc",
          createdAt: "2026-09-02T09:35:21+02:00",
          url: "https://codeberg.org/forgejo/forgejo/issues/14217",
        },
      ],
      hasNextPage: true,
      totalCount: null,
    },
    pullRequests: {
      items: [
        {
          number: 14233,
          title: "Update CodeMirror (forgejo)",
          state: "open",
          labels: ["dependency-upgrade", "test/not-needed"],
          author: "viceice-bot",
          createdAt: "2026-09-04T02:01:12+02:00",
          url: "https://codeberg.org/forgejo/forgejo/pulls/14233",
          draft: false,
          merged: false,
          sourceBranch: "renovate/forgejo-codemirror",
          targetBranch: "forgejo",
          headSha: "8e054e904377f922d9ef7d8b0b00aa18bd20c9a3",
          mergeable: true,
        },
        {
          number: 14230,
          title: "fix(indexer): avoid large issue search queries",
          state: "open",
          labels: [],
          author: "famfo-cb",
          createdAt: "2026-09-03T12:16:20+02:00",
          url: "https://codeberg.org/forgejo/forgejo/pulls/14230",
          draft: false,
          merged: false,
          sourceBranch: "refs/pull/14230/head",
          targetBranch: "forgejo",
          headSha: "b88827c0d17cf1da009b5fb9ada6023c6bcaee13",
          mergeable: true,
        },
        {
          number: 14221,
          title: "fix(quota): avoid double-counting package blobs",
          state: "open",
          labels: [
            "backport/v15.0/forgejo",
            "backport/v16.0/forgejo",
            "bug/confirmed",
            "code/packages",
          ],
          author: "Maks1mS",
          createdAt: "2026-09-02T20:04:14+02:00",
          url: "https://codeberg.org/forgejo/forgejo/pulls/14221",
          draft: false,
          merged: false,
          sourceBranch: "fix/better-packages-size",
          targetBranch: "forgejo",
          headSha: "09a1ecaf23017d046b8da0bd79d19374c7b29e68",
          mergeable: true,
        },
        {
          number: 14220,
          title: "WIP: feat(packages): Allow cleaning based on last download timestamp.",
          state: "open",
          labels: ["code/packages", "enhancement/feature", "test/needed", "worth a release-note"],
          author: "kad-hollac1",
          createdAt: "2026-09-02T16:11:50+02:00",
          url: "https://codeberg.org/forgejo/forgejo/pulls/14220",
          draft: true,
          merged: false,
          sourceBranch: "refs/pull/14220/head",
          targetBranch: "forgejo",
          headSha: "7d6cbe1929ee656e76ab22ecac9943506b498cc4",
          mergeable: false,
        },
        {
          number: 14218,
          title: "fix(git): use credential helper for HTTP migrations",
          state: "open",
          labels: ["bug/confirmed", "test/present"],
          author: "pmnmqc",
          createdAt: "2026-09-02T09:57:47+02:00",
          url: "https://codeberg.org/forgejo/forgejo/pulls/14218",
          draft: false,
          merged: false,
          sourceBranch: "fix/http-credential-store-userinfo",
          targetBranch: "forgejo",
          headSha: "d0da393e40166338f0d15d6222085ac261707024",
          mergeable: true,
        },
      ],
      hasNextPage: true,
    },
    commits: [
      {
        sha: "8295dea704e1c18ded9965dc8a20981df30945b9",
        message: "fix: SQL query optimizations (#14206)",
        author: {
          name: "famfo",
          date: "2026-09-03T04:45:22+02:00",
        },
        parents: 1,
        url: "https://codeberg.org/forgejo/forgejo/commit/8295dea704e1c18ded9965dc8a20981df30945b9",
      },
      {
        sha: "8fc8a89b5ca7238b1fd655623cfb49508dcf028c",
        message: "refactor: use methods instead of events for run notifications (#14157)",
        author: {
          name: "Andreas Ahlenstorf",
          date: "2026-09-03T04:36:44+02:00",
        },
        parents: 1,
        url: "https://codeberg.org/forgejo/forgejo/commit/8fc8a89b5ca7238b1fd655623cfb49508dcf028c",
      },
      {
        sha: "b086c8aa229cc1ce3da64265ec72c178a1ac5497",
        message: "Update module golang.org/x/crypto to v0.56.0 [SECURITY] (forgejo) (#14222)",
        author: {
          name: "Renovate Bot",
          date: "2026-09-02T23:20:40+02:00",
        },
        parents: 1,
        url: "https://codeberg.org/forgejo/forgejo/commit/b086c8aa229cc1ce3da64265ec72c178a1ac5497",
      },
      {
        sha: "fe9f7fb2f2db07277ee6eef81d59b103cd1ca907",
        message: "Update https://codeberg.org/clouds666/unkai action to v0.2.9 (forgejo) (#14219)",
        author: {
          name: "Renovate Bot",
          date: "2026-09-02T16:14:54+02:00",
        },
        parents: 1,
        url: "https://codeberg.org/forgejo/forgejo/commit/fe9f7fb2f2db07277ee6eef81d59b103cd1ca907",
      },
      {
        sha: "86e92ad29d6b0fab74d2a40a682616dc738247e7",
        message:
          "fix: additional permission checks and tests for PATCH /repos/{owner}/{repo}/issues/{index} (#14173)",
        author: {
          name: "limiting-factor",
          date: "2026-09-02T09:15:27+02:00",
        },
        parents: 1,
        url: "https://codeberg.org/forgejo/forgejo/commit/86e92ad29d6b0fab74d2a40a682616dc738247e7",
      },
    ],
    ciRuns: [
      {
        id: "6848977",
        branch: "forgejo",
        revision: "8295dea704e1c18ded9965dc8a20981df30945b9",
        status: "completed",
        conclusion: "skipped",
        url: "https://codeberg.org/forgejo/forgejo/actions/runs/195187",
      },
      {
        id: "6848911",
        branch: "fix/better-packages-size",
        revision: "09a1ecaf23017d046b8da0bd79d19374c7b29e68",
        status: "in_progress",
        conclusion: null,
        url: "https://codeberg.org/forgejo/forgejo/actions/runs/195186",
      },
      {
        id: "6848908",
        branch: "fix/better-packages-size",
        revision: "09a1ecaf23017d046b8da0bd79d19374c7b29e68",
        status: "completed",
        conclusion: "success",
        url: "https://codeberg.org/forgejo/forgejo/actions/runs/195185",
      },
      {
        id: "6848905",
        branch: "fix/better-packages-size",
        revision: "09a1ecaf23017d046b8da0bd79d19374c7b29e68",
        status: "completed",
        conclusion: "success",
        url: "https://codeberg.org/forgejo/forgejo/actions/runs/195184",
      },
      {
        id: "6848818",
        branch: "renovate/forgejo-lock-file-maintenance",
        revision: "7310ebcb29129aceebb5d87928864a2c1a986a0c",
        status: "completed",
        conclusion: "success",
        url: "https://codeberg.org/forgejo/forgejo/actions/runs/195183",
      },
    ],
    threads: {
      number: 14221,
      items: [
        {
          id: "22261591",
          isResolved: true,
          isOutdated: false,
          path: "models/packages/fixtures/TestCalculateFileSize/package_version.yml",
          line: 24,
          comments: [
            {
              author: "aahlenst",
              body: "I only see packages with IDs 1 and 2 in `package.yml`.",
              createdAt: "2026-09-03T13:33:02+02:00",
            },
          ],
        },
        {
          id: "22261864",
          isResolved: true,
          isOutdated: false,
          path: "models/packages/package_file_test.go",
          line: 21,
          comments: [
            {
              author: "aahlenst",
              body: "Wouldn't it make sense to verify that the package size is counted by user, even if the users share a blob? Because the fixtures only contain packages owned by a single user, we ca…",
              createdAt: "2026-09-03T13:40:04+02:00",
            },
          ],
        },
      ],
    },
    live: false,
  },
];
