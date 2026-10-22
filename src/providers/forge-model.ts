/**
 * The `forges` model mapped to our types.
 *
 * Every forge `forges` serves reads the same through these, so a provider for
 * a new one needs only its factory. A field the model doesn't carry comes out
 * null where our type allows it, and empty, false or zero where it doesn't.
 */

import type {
  Actor,
  ChangedFile as ForgeChangedFile,
  Check,
  CheckState,
  CiJob as ForgeCiJob,
  CiRun as ForgeCiRun,
  Comment as ForgeComment,
  Commit as ForgeCommit,
  CommitSignature,
  Release as ForgeRelease,
  Repo,
  Review,
  ReviewComment,
  Tag as ForgeTag,
  Thread as ForgeThread,
  User as ForgeUser,
} from "forges";

import { normalizeChangedFileStatus } from "../changed-file.ts";
import { normalizeCiRunState } from "../ci-run.ts";
import { mapBooleanRepositoryPermission } from "../repository-access.ts";
import { knownMergeMethod, mergeSettings } from "../repository-merge.ts";
import type {
  ChangedFile,
  CiJob,
  CiRun,
  CiRunConclusion,
  CiRunStatus,
  Comment,
  Commit,
  CommitIdentity,
  CommitSummary,
  Issue,
  Owner,
  PullRequest,
  PullRequestCheck,
  Release,
  Repository,
  Tag,
  Thread,
  ThreadComment,
  User,
} from "../types.ts";

/** One review conversation: its comments in order, gathered from every review. */
export interface ReviewConversation {
  id: string;
  resolved: boolean;
  comments: ReviewComment[];
}

/** The terminal outcome a normalised check state carries on its own. */
const CHECK_CONCLUSIONS: Readonly<Record<CheckState, CiRunConclusion>> = {
  success: "success",
  failure: "failure",
  neutral: "neutral",
  pending: null,
  unknown: null,
};

/** Some forges build dates without checking them, and an invalid one would throw the whole record away. */
function isoOrNull(date: Date | undefined): string | null {
  return date === undefined || Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function iso(date: Date | undefined): string {
  return isoOrNull(date) ?? "";
}

function login(actor: Actor | undefined): { login: string } {
  return { login: actor?.login ?? "" };
}

function identity(signature: CommitSignature | undefined): CommitIdentity {
  return {
    name: signature?.name ?? "",
    email: signature?.email ?? "",
    date: iso(signature?.date),
  };
}

/** The forge's own words first, since they tell queued from running; the model's state settles the rest. */
function ciState(item: Readonly<{ state: CheckState; stateRaw: string; conclusionRaw?: string }>): {
  status: CiRunStatus;
  conclusion: CiRunConclusion;
} {
  const raw = normalizeCiRunState(item.stateRaw, item.conclusionRaw);
  const conclusion = CHECK_CONCLUSIONS[item.state];
  if (raw.conclusion !== null || conclusion === null) return raw;
  return { status: "completed", conclusion };
}

export function ownerFromModel(actor: Actor): Owner {
  return { login: actor.login, avatarUrl: actor.avatarUrl ?? "" };
}

/** The model has no email or admin flag, and a forge that withholds counts reports none. */
export function userFromModel(user: ForgeUser): User {
  return {
    id: user.id,
    login: user.login,
    name: user.name ?? "",
    email: "",
    avatarUrl: user.avatarUrl ?? "",
    isAdmin: false,
    bio: user.bio ?? "",
    company: user.company ?? "",
    location: user.location ?? "",
    website: user.websiteUrl ?? "",
    followers: user.followers ?? 0,
    following: user.following ?? 0,
    createdAt: iso(user.createdAt),
    url: user.url ?? "",
  };
}

/** A merge method the model names but we don't (`fast_forward_only`) drops out. */
function repositoryMerge(repo: Repo): Repository["merge"] {
  const allowed = repo.mergeMethods;
  if (allowed === undefined) return null;
  const squash = repo.mergeCommit?.squash;
  return mergeSettings(
    {
      merge: allowed.includes("merge"),
      squash: allowed.includes("squash"),
      rebase: allowed.includes("rebase"),
    },
    {
      defaultMethod: knownMergeMethod(repo.defaultMergeMethod),
      squashTitle: squash?.titleRaw ?? null,
      squashMessage: squash?.messageRaw ?? null,
      deleteBranchOnMerge: repo.deleteBranchOnMerge ?? null,
    },
  );
}

/** `fullName` keeps the names `forges` addresses the repository by, so it reads back as given. */
export function repositoryFromModel(repo: Repo): Repository {
  const { ref, parent } = repo;
  return {
    id: ref.externalId ?? "",
    name: repo.displayName ?? ref.name,
    fullName: `${ref.owner}/${ref.name}`,
    description: repo.description ?? "",
    private: repo.visibility !== "public",
    defaultBranch: repo.defaultBranch ?? "",
    url: repo.url ?? "",
    cloneUrl: repo.cloneUrls?.https ?? "",
    isFork: repo.isFork,
    parent: parent === undefined ? null : { fullName: `${parent.owner}/${parent.name}`, url: "" },
    viewerPermission: mapBooleanRepositoryPermission(repo.permissions),
    merge: repositoryMerge(repo),
    owner: repo.owner ? ownerFromModel(repo.owner) : { login: ref.owner, avatarUrl: "" },
  };
}

/** Merged and closed both read as closed, and so does a state the model can't name. */
export function issueFromModel(thread: ForgeThread): Issue {
  return {
    id: thread.ref.externalId ?? "",
    number: Number(thread.ref.number),
    title: thread.title,
    body: thread.body ?? "",
    state: thread.state === "open" ? "open" : "closed",
    labels: thread.labels.map((label) => label.name),
    author: login(thread.author),
    assignees: thread.assignees.map(login),
    createdAt: iso(thread.createdAt),
    updatedAt: iso(thread.updatedAt),
    url: thread.url ?? "",
  };
}

/** The model reports no mergeability, so it stays unknown. */
export function pullRequestFromModel(thread: ForgeThread): PullRequest {
  const branches = thread.branches;
  return {
    ...issueFromModel(thread),
    merged: thread.state === "merged",
    draft: thread.isDraft,
    sourceBranch: branches?.head.ref ?? "",
    targetBranch: branches?.base.ref ?? "",
    mergeCommitSha: branches?.mergeCommitSha ?? "",
    mergedAt: isoOrNull(thread.mergedAt),
    mergedBy: thread.mergedBy ? login(thread.mergedBy) : null,
    headSha: branches?.head.sha ?? "",
    mergeable: null,
    mergeStatus: "",
  };
}

export function commentFromModel(comment: ForgeComment): Comment {
  return {
    id: comment.ref.id,
    body: comment.body,
    author: login(comment.author),
    url: comment.url ?? "",
    createdAt: iso(comment.createdAt),
    updatedAt: iso(comment.updatedAt),
  };
}

export function releaseFromModel(release: ForgeRelease): Release {
  return {
    id: release.ref.id,
    tag: release.tag,
    name: release.name ?? "",
    body: release.body ?? "",
    draft: release.isDraft,
    prerelease: release.isPrerelease,
    author: login(release.author),
    createdAt: iso(release.createdAt),
    publishedAt: iso(release.publishedAt),
    url: release.url ?? "",
  };
}

/** A forge that names no commit for a tag on a tree or blob sends an empty sha. */
export function tagFromModel(tag: ForgeTag): Tag {
  return { name: tag.name, sha: tag.sha || null };
}

export function commitSummaryFromModel(commit: ForgeCommit): CommitSummary {
  return {
    sha: commit.sha,
    message: commit.message,
    author: identity(commit.author),
    committer: identity(commit.committer),
    parents: commit.parents,
    url: commit.url ?? "",
  };
}

/** The model never says whether a forge cut the file list short. */
export function commitFromModel(commit: ForgeCommit): Commit {
  return {
    ...commitSummaryFromModel(commit),
    files: (commit.files ?? []).map(changedFileFromModel),
    filesComplete: null,
  };
}

/** The forge's own status goes first, as before; one we don't know falls back to the model's. */
export function changedFileFromModel(file: ForgeChangedFile): ChangedFile {
  const status = normalizeChangedFileStatus(file.statusRaw ?? file.status);
  return {
    path: file.path,
    status: status === "unknown" ? normalizeChangedFileStatus(file.status) : status,
    additions: file.additions ?? null,
    deletions: file.deletions ?? null,
  };
}

export function ciRunFromModel(run: ForgeCiRun): CiRun {
  return {
    id: run.ref.id,
    branch: run.branch ?? "",
    revision: run.sha ?? "",
    ...ciState(run),
    url: run.url ?? "",
  };
}

/** The model has no job steps; `runId` names the run the jobs were listed for. */
export function ciJobFromModel(job: ForgeCiJob, runId: string): CiJob {
  return {
    id: job.ref.id,
    runId: job.ref.run?.id ?? runId,
    name: job.name,
    ...ciState(job),
    startedAt: isoOrNull(job.startedAt),
    completedAt: isoOrNull(job.completedAt),
    url: job.url ?? "",
    steps: [],
  };
}

export function checkFromModel(check: Check): PullRequestCheck {
  return { id: check.ref.id, name: check.name, ...ciState(check), url: check.url ?? "" };
}

export function threadCommentFromModel(comment: ReviewComment): ThreadComment {
  return {
    id: comment.ref?.id ?? "",
    body: comment.body,
    author: login(comment.author),
    url: comment.url ?? "",
    createdAt: iso(comment.createdAt),
  };
}

/** The model marks neither outdated comments nor a range's first line. */
export function threadFromModel(conversation: ReviewConversation): Thread {
  const first = conversation.comments[0];
  return {
    id: conversation.id,
    isResolved: conversation.resolved,
    isOutdated: false,
    path: first?.path ?? "",
    line: first?.line ?? null,
    startLine: null,
    comments: conversation.comments.map(threadCommentFromModel),
  };
}

/** A reply chain leads back to the comment that opened it; a parent we never saw ends the walk. */
function rootId(comment: ReviewComment, byId: ReadonlyMap<string, ReviewComment>): string {
  let current = comment;
  const seen = new Set<string>();
  while (current.inReplyTo !== undefined && !seen.has(current.inReplyTo)) {
    seen.add(current.inReplyTo);
    const parent = byId.get(current.inReplyTo);
    if (parent === undefined) return current.inReplyTo;
    current = parent;
  }
  return current.ref?.id ?? "";
}

/** Comments per conversation; lacking ids, a reply joins the comment its chain started from. */
export function reviewConversations(reviews: readonly Review[]): ReviewConversation[] {
  const comments = reviews.flatMap((review) => review.comments || []);
  const byId = new Map(
    comments.flatMap((comment) => (comment.ref ? [[comment.ref.id, comment]] : [])),
  );
  const conversations = new Map<string, ReviewConversation>();
  for (const comment of comments) {
    const id = comment.thread?.id ?? rootId(comment, byId);
    const conversation = conversations.get(id);
    if (conversation === undefined) {
      conversations.set(id, {
        id,
        resolved: comment.thread?.resolved ?? false,
        comments: [comment],
      });
    } else {
      conversation.comments.push(comment);
      conversation.resolved ||= comment.thread?.resolved ?? false;
    }
  }
  return [...conversations.values()];
}
