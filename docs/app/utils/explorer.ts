/** The docs API answers as the explorer reads them; the shapes live in the route files and server/utils/slim.ts. */

export interface WireIssue {
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

export interface WirePullRequest extends WireIssue {
  draft: boolean;
  merged: boolean;
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  mergeable: boolean | null;
  mergeStatus: string;
}

export interface WireCommit {
  sha: string;
  message: string;
  author: { name: string; date: string };
  parents: number;
  url: string;
}

export interface WireCiRun {
  id: string;
  branch: string;
  revision: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export interface WireThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: { author: string; body: string; createdAt: string }[];
}

export interface RepoAnswer {
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

export interface PageAnswer<T> {
  platform: string;
  items: T[];
  hasNextPage: boolean;
  totalCount?: number | null;
  fetchedAt: string;
}

export interface ThreadsAnswer extends PageAnswer<WireThread> {
  number: number;
}

export interface UserAnswer {
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

export interface PlatformsAnswer {
  version: string;
  platforms: { platform: string; authenticated: boolean; host: string }[];
}

export type Operation =
  | "repo"
  | "issues"
  | "pulls"
  | "commits"
  | "ci"
  | "threads"
  | "user"
  | "platforms";

/** Every operation the explorer runs, in the order of its leads, with the library call and the tool behind it. */
export const OPERATIONS: ReadonlyArray<{
  key: Operation;
  tag: string;
  call: string;
  tool: string;
  route: string;
  about: string;
}> = [
  {
    key: "repo",
    tag: "Repo",
    call: "repos.get",
    tool: "forges_repos_get",
    route: "/api/repo",
    about: "One repository: id as a string, default branch, fork and parent, clone URL.",
  },
  {
    key: "issues",
    tag: "Issues",
    call: "issues.list",
    tool: "forges_issues_list",
    route: "/api/issues",
    about: "Issues without bodies, oldest first. On GitHub the pull requests are dropped.",
  },
  {
    key: "pulls",
    tag: "Pulls",
    call: "pullRequests.list",
    tool: "forges_pull_requests_list",
    route: "/api/pulls",
    about: "Pull requests and merge requests with branches, head SHA, draft and merge state.",
  },
  {
    key: "commits",
    tag: "Commits",
    call: "commits.list",
    tool: "forges_commits_list",
    route: "/api/commits",
    about: "The default branch, newest first. No patches in a list.",
  },
  {
    key: "ci",
    tag: "CI",
    call: "ciRuns.list",
    tool: "forges_ci_runs_list",
    route: "/api/ci",
    about: "Actions runs or pipelines as one lifecycle status and one conclusion.",
  },
  {
    key: "threads",
    tag: "Threads",
    call: "threads.list",
    tool: "forges_threads_list",
    route: "/api/threads",
    about: "Review threads of one pull request, with the id reply and resolve take back.",
  },
  {
    key: "user",
    tag: "User",
    call: "users.get",
    tool: "forges_users_get",
    route: "/api/user",
    about: "A public profile. Empty fields stay empty strings, never guessed.",
  },
  {
    key: "platforms",
    tag: "Worker",
    call: "platforms",
    tool: "forges_users_authenticated",
    route: "/api/platforms",
    about: "Which platforms the docs worker holds a token for, and where it points.",
  },
];
