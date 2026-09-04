import type {
  CiRun,
  CiRunConclusion,
  CiRunStatus,
  CommitSummary,
  Issue,
  IssueState,
  PullRequest,
  Thread,
} from "@agntn/forges";

/** Cuts a text at `max` code points with an ellipsis. */
export function cut(value: string, max: number): string {
  const points = [...value];
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : value;
}

/** Wire shapes for the explorer and the landing. No bodies, an issue body is somebody else's text. */
export interface WireIssue {
  number: number;
  title: string;
  state: IssueState;
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
  status: CiRunStatus;
  conclusion: CiRunConclusion;
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

export function slimIssue(issue: Issue): WireIssue {
  return {
    number: issue.number,
    title: cut(issue.title, 160),
    state: issue.state,
    labels: issue.labels.slice(0, 6),
    author: issue.author.login,
    assignees: issue.assignees.map((row) => row.login),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    url: issue.url,
  };
}

export function slimPullRequest(pr: PullRequest): WirePullRequest {
  return {
    ...slimIssue(pr),
    draft: pr.draft,
    merged: pr.merged,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    headSha: pr.headSha,
    mergeable: pr.mergeable,
    mergeStatus: pr.mergeStatus,
  };
}

export function slimCommit(commit: CommitSummary): WireCommit {
  return {
    sha: commit.sha,
    message: cut(commit.message.split(/\r?\n/u, 1)[0]?.trim() ?? "", 120),
    author: { name: commit.author.name, date: commit.author.date },
    parents: commit.parents.length,
    url: commit.url,
  };
}

export function slimCiRun(run: CiRun): WireCiRun {
  return {
    id: run.id,
    branch: run.branch,
    revision: run.revision,
    status: run.status,
    conclusion: run.conclusion,
    url: run.url,
  };
}

/** Each comment is bounded the way `forges_threads_list` bounds it, and no email or avatar travels. */
export function slimThread(thread: Thread): WireThread {
  return {
    id: thread.id,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    path: thread.path,
    line: thread.line,
    comments: thread.comments.slice(0, 6).map((comment) => ({
      author: comment.author.login,
      body: cut(comment.body.replace(/\s+/gu, " ").trim(), 400),
      createdAt: comment.createdAt,
    })),
  };
}
