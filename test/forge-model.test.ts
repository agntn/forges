import type { ForgeProvider, Repo, Review, ReviewComment, Thread } from "forges";
import { fake } from "forges/fake";
import { describe, expect, it, vi } from "vite-plus/test";

import { NotFoundError } from "../src/errors.ts";
import { ForgeBackedProvider } from "../src/providers/forge.ts";
import {
  changedFileFromModel,
  ciRunFromModel,
  issueFromModel,
  repositoryFromModel,
  reviewConversations,
  tagFromModel,
} from "../src/providers/forge-model.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);

/** A provider for a forge with nothing but its factory: everything else comes from the base. */
class FactoryOnlyProvider extends ForgeBackedProvider {
  readonly #forge: ForgeProvider;

  constructor(forge: ForgeProvider) {
    super("fake", { apiBaseURL: "https://fake.test", token: "token" });
    this.#forge = forge;
  }

  protected override createForge(): ForgeProvider {
    return this.#forge;
  }
}

function seeded() {
  const forge = fake({
    viewer: "octo",
    now: () => NOW,
    seed: {
      repos: [{ repo: "acme/widgets", description: "Widgets", defaultBranch: "main" }],
      commits: [
        {
          repo: "acme/widgets",
          sha: SHA,
          message: "Add widgets",
          author: "octo",
          committedAt: NOW,
          files: [{ path: "widget.ts", status: "added", additions: 3 }],
        },
      ],
      runs: [
        {
          repo: "acme/widgets",
          name: "ci",
          state: "success",
          branch: "main",
          sha: SHA,
          jobs: [{ name: "test", state: "failure" }],
        },
      ],
      releases: [{ repo: "acme/widgets", tag: "v1.0.0", name: "One", body: "First cut" }],
      threads: [
        {
          repo: "acme/widgets",
          kind: "issue",
          title: "Widgets wobble",
          body: "They wobble.",
          labels: ["bug"],
          assignees: ["octo"],
          comments: [{ body: "Same here", author: "hubot" }],
        },
        {
          repo: "acme/widgets",
          kind: "pull_request",
          title: "Steady the widgets",
          body: "Fixes #1",
          head: { ref: "steady", sha: HEAD },
          checks: [{ name: "lint", state: "pending" }],
          files: [{ path: "widget.ts", status: "modified", additions: 1, deletions: 1 }],
          comments: [{ body: "Nice" }],
        },
      ],
    },
  });
  return { forge, provider: new FactoryOnlyProvider(forge as unknown as ForgeProvider) };
}

describe("a provider built on nothing but a forges factory", () => {
  it("reads a repository and its owner's repositories", async () => {
    const { provider } = seeded();

    const repository = await provider.repos.get({ owner: "acme", repo: "widgets" });
    const listed = await provider.repos.list("acme");

    expect(repository).toMatchObject({
      name: "widgets",
      fullName: "acme/widgets",
      description: "Widgets",
      private: false,
      defaultBranch: "main",
      url: "https://fake.test/acme/widgets",
      parent: null,
      owner: { login: "acme" },
    });
    expect(listed.items).toEqual([repository]);
  });

  it("reads issues and their comments", async () => {
    const { provider } = seeded();

    const issues = await provider.issues.list({ owner: "acme", repo: "widgets" });
    const issue = await provider.issues.get({ owner: "acme", repo: "widgets", number: 1 });
    const comments = await provider.issues.listComments({
      owner: "acme",
      repo: "widgets",
      number: 1,
    });
    const [comment] = comments.items;

    expect(issues.items).toEqual([issue]);
    expect(issue).toEqual({
      id: "",
      number: 1,
      title: "Widgets wobble",
      body: "They wobble.",
      state: "open",
      labels: ["bug"],
      author: { login: "octo" },
      assignees: [{ login: "octo" }],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      url: "https://fake.test/acme/widgets/issues/1",
    });
    expect(comment).toMatchObject({ body: "Same here", author: { login: "hubot" } });
    await expect(
      provider.issues.getComment(
        { owner: "acme", repo: "widgets", number: 1 },
        { commentId: comment!.id },
      ),
    ).resolves.toEqual(comment);
  });

  it("keeps a comment to the thread it was asked under", async () => {
    const { provider } = seeded();
    const [comment] = (
      await provider.pullRequests.listComments({ owner: "acme", repo: "widgets", number: 2 })
    ).items;

    await expect(
      provider.issues.getComment(
        { owner: "acme", repo: "widgets", number: 1 },
        { commentId: comment!.id },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates an issue", async () => {
    const { provider } = seeded();

    const issue = await provider.issues.create(
      { owner: "acme", repo: "widgets" },
      {
        title: "Widgets squeak",
        body: "Loudly.",
        labels: ["bug"],
      },
    );

    expect(issue).toMatchObject({ number: 3, title: "Widgets squeak", labels: ["bug"] });
    await expect(
      provider.issues.get({ owner: "acme", repo: "widgets", number: 3 }),
    ).resolves.toEqual(issue);
  });

  it("reads pull requests with their files and checks", async () => {
    const { provider } = seeded();

    const pulls = await provider.pullRequests.list({ owner: "acme", repo: "widgets" });
    const pull = await provider.pullRequests.get({ owner: "acme", repo: "widgets", number: 2 });
    const files = await provider.pullRequests.listFiles({
      owner: "acme",
      repo: "widgets",
      number: 2,
    });
    const checks = await provider.pullRequests.listChecks({
      owner: "acme",
      repo: "widgets",
      number: 2,
    });

    expect(pulls.items).toEqual([pull]);
    expect(pull).toMatchObject({
      number: 2,
      state: "open",
      merged: false,
      draft: false,
      sourceBranch: "steady",
      targetBranch: "main",
      headSha: HEAD,
      mergedAt: null,
      mergedBy: null,
      mergeable: null,
    });
    expect(files.items).toEqual([
      { path: "widget.ts", status: "modified", additions: 1, deletions: 1 },
    ]);
    expect(checks.items).toEqual([
      expect.objectContaining({ name: "lint", status: "queued", conclusion: null }),
    ]);
  });

  it("finds no pull request behind an issue number", async () => {
    const { provider } = seeded();

    await expect(
      provider.pullRequests.get({ owner: "acme", repo: "widgets", number: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opens a pull request with every field it was given", async () => {
    const { forge, provider } = seeded();
    const create = vi.spyOn(forge.threads, "create");

    const pull = await provider.pullRequests.create(
      { owner: "acme", repo: "widgets" },
      {
        title: "Polish the widgets",
        body: "Shiny.",
        sourceBranch: "polish",
        targetBranch: "main",
        draft: true,
      },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", name: "widgets" }),
      {
        kind: "pull_request",
        title: "Polish the widgets",
        body: "Shiny.",
        head: "polish",
        base: "main",
        draft: true,
      },
    );
    expect(pull).toMatchObject({
      title: "Polish the widgets",
      sourceBranch: "polish",
      targetBranch: "main",
    });
  });

  it("reads commits, CI runs and their jobs", async () => {
    const { provider } = seeded();

    const commit = await provider.commits.get({ owner: "acme", repo: "widgets" }, { sha: SHA });
    const runs = await provider.ciRuns.list({ owner: "acme", repo: "widgets" });
    const [run] = runs.items;
    const jobs = await provider.ciRuns.listJobs(
      { owner: "acme", repo: "widgets" },
      { runId: run!.id },
    );

    expect(commit).toMatchObject({
      sha: SHA,
      message: "Add widgets",
      author: { name: "octo", date: NOW.toISOString() },
      files: [{ path: "widget.ts", status: "added", additions: 3, deletions: 0 }],
      filesComplete: null,
    });
    expect(run).toMatchObject({
      branch: "main",
      revision: SHA,
      status: "completed",
      conclusion: "success",
    });
    expect(jobs.items).toEqual([
      expect.objectContaining({
        runId: run!.id,
        name: "test",
        status: "completed",
        conclusion: "failure",
        steps: [],
      }),
    ]);
  });

  it("reads and writes releases", async () => {
    const { provider } = seeded();

    const release = await provider.releases.get(
      { owner: "acme", repo: "widgets" },
      { tag: "v1.0.0" },
    );
    const updated = await provider.releases.update(
      { owner: "acme", repo: "widgets" },
      { tag: "v1.0.0", body: "Second look" },
    );

    expect(release).toMatchObject({ tag: "v1.0.0", name: "One", body: "First cut" });
    expect(updated).toMatchObject({ tag: "v1.0.0", name: "One", body: "Second look" });
  });

  it("reads the signed-in account", async () => {
    const { provider } = seeded();

    await expect(provider.users.authenticated()).resolves.toMatchObject({
      login: "octo",
      email: "",
      isAdmin: false,
    });
  });

  it("lists, answers and resolves review threads", async () => {
    const { forge, provider } = seeded();
    const pull = {
      forge: forge.forge,
      instance: forge.instance,
      repo: { forge: forge.forge, instance: forge.instance, owner: "acme", name: "widgets" },
      kind: "pull_request" as const,
      number: "2",
    };
    await forge.threads.createReview(pull, {
      event: "comment",
      comments: [{ path: "widget.ts", line: 4, body: "Wobbles here" }],
    });

    const [thread] = (await provider.threads.list({ owner: "acme", repo: "widgets", number: 2 }))
      .items;
    const reply = await provider.threads.reply(
      { owner: "acme", repo: "widgets", number: 2 },
      { threadId: thread!.id, body: "Steadied" },
    );
    const resolved = await provider.threads.resolve(
      { owner: "acme", repo: "widgets", number: 2 },
      { threadId: thread!.id },
    );
    const open = await provider.threads.list(
      { owner: "acme", repo: "widgets", number: 2 },
      { state: "unresolved" },
    );
    const reopened = await provider.threads.unresolve(
      { owner: "acme", repo: "widgets", number: 2 },
      { threadId: thread!.id },
    );

    expect(thread).toMatchObject({
      isResolved: false,
      isOutdated: false,
      path: "widget.ts",
      line: 4,
      startLine: null,
      comments: [{ body: "Wobbles here", author: { login: "octo" } }],
    });
    expect(reply).toMatchObject({ body: "Steadied", author: { login: "octo" } });
    expect(resolved).toMatchObject({ id: thread!.id, isResolved: true });
    expect(resolved.comments.map((comment) => comment.body)).toEqual(["Wobbles here", "Steadied"]);
    expect(open.items).toEqual([]);
    expect(reopened.isResolved).toBe(false);
    await expect(
      provider.threads.get({ owner: "acme", repo: "widgets", number: 2 }, { threadId: thread!.id }),
    ).resolves.toEqual(reopened);
  });

  it("finds no review threads behind an issue number, whichever read fails first", async () => {
    const { forge, provider } = seeded();
    vi.spyOn(forge.threads, "reviews").mockReturnValue({
      page: () => Promise.reject(new Error("reviews gave up first")),
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("reviews gave up first")),
      }),
    });

    await expect(
      provider.threads.list({ owner: "acme", repo: "widgets", number: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("finds no thread under an id the pull request doesn't have", async () => {
    const { provider } = seeded();

    await expect(
      provider.threads.resolve(
        { owner: "acme", repo: "widgets", number: 2 },
        { threadId: "elsewhere" },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

function reviewComment(id: string, inReplyTo?: string): ReviewComment {
  return {
    ref: { forge: "fake", instance: "fake.test", thread: {} as never, id },
    body: id,
    path: "widget.ts",
    line: 1,
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
    raw: {},
  };
}

function review(comments: ReviewComment[]): Review {
  return { comments, state: "commented", raw: {} } as unknown as Review;
}

describe("reviewConversations", () => {
  it("joins replies to the comment their chain started from when the forge names no conversation", () => {
    const conversations = reviewConversations([
      review([reviewComment("1"), reviewComment("2")]),
      review([reviewComment("3", "1"), reviewComment("4", "3")]),
    ]);

    expect(conversations.map(({ id, comments }) => [id, comments.map((c) => c.body)])).toEqual([
      ["1", ["1", "3", "4"]],
      ["2", ["2"]],
    ]);
  });

  it("keys a reply to a comment it never saw by that comment's id", () => {
    const [conversation] = reviewConversations([review([reviewComment("5", "missing")])]);

    expect(conversation).toMatchObject({ id: "missing", resolved: false });
  });

  it("skips reviews that carry approvals but no comments", () => {
    expect(reviewConversations([{ ...review([]), comments: false }])).toEqual([]);
  });
});

describe("ciRunFromModel", () => {
  function run(state: "pending" | "success" | "unknown", stateRaw: string) {
    return ciRunFromModel({
      ref: { forge: "fake", instance: "fake.test", repo: {} as never, id: "1" },
      name: "ci",
      state,
      stateRaw,
      raw: {},
    });
  }

  it.each([
    ["pending", "queued", { status: "queued", conclusion: null }],
    ["pending", "running", { status: "in_progress", conclusion: null }],
    ["success", "completed", { status: "completed", conclusion: "success" }],
    ["success", "PASSED", { status: "completed", conclusion: "success" }],
    ["unknown", "mystery", { status: "in_progress", conclusion: null }],
  ] as const)("reads %s as %s", (state, stateRaw, expected) => {
    expect(run(state, stateRaw)).toMatchObject(expected);
  });
});

describe("repositoryFromModel", () => {
  const base: Repo = {
    ref: { forge: "fake", instance: "fake.test", owner: "acme", name: "widgets", externalId: "7" },
    visibility: "private",
    isFork: true,
    isArchived: false,
    topics: [],
    parent: { forge: "fake", instance: "fake.test", owner: "upstream", name: "widgets" },
    permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
    mergeMethods: ["squash", "fast_forward_only"],
    defaultMergeMethod: "squash",
    mergeCommit: { squash: { titleRaw: "PR_TITLE", messageRaw: "PR_BODY" } },
    raw: {},
  };

  it("maps access, merge settings and the upstream", () => {
    expect(repositoryFromModel(base)).toMatchObject({
      id: "7",
      private: true,
      isFork: true,
      parent: { fullName: "upstream/widgets", url: "" },
      viewerPermission: "write",
      merge: {
        methods: ["squash"],
        defaultMethod: "squash",
        squashTitle: "PR_TITLE",
        squashMessage: "PR_BODY",
        deleteBranchOnMerge: null,
      },
    });
  });

  it("leaves merge settings and access unknown when the forge reports none", () => {
    const { mergeMethods: _methods, permissions: _permissions, ...bare } = base;

    expect(repositoryFromModel(bare)).toMatchObject({ merge: null, viewerPermission: null });
  });
});

describe("issueFromModel", () => {
  it.each([
    ["open", "open"],
    ["merged", "closed"],
    ["unknown", "closed"],
  ] as const)("reads %s as %s", (state, expected) => {
    const thread = {
      ref: { number: "1" },
      kind: "issue",
      title: "t",
      state,
      isDraft: false,
      assignees: [],
      reviewers: [],
      labels: [],
      raw: {},
    } as unknown as Thread;

    expect(issueFromModel(thread).state).toBe(expected);
  });
});

describe("small model mappers", () => {
  it("leaves out a date the forge could not read instead of throwing", () => {
    const thread = {
      ref: { number: "1" },
      kind: "issue",
      title: "t",
      state: "open",
      isDraft: false,
      assignees: [],
      reviewers: [],
      labels: [],
      createdAt: new Date("not a date"),
      raw: {},
    } as unknown as Thread;

    expect(issueFromModel(thread)).toMatchObject({ number: 1, createdAt: "", updatedAt: "" });
  });

  it("names no commit for a tag the forge peels to nothing", () => {
    expect(tagFromModel({ name: "tree-tag", sha: "", raw: {} })).toEqual({
      name: "tree-tag",
      sha: null,
    });
  });

  it("falls back to the model's file status when the forge's own word is unfamiliar", () => {
    expect(
      changedFileFromModel({ path: "a.ts", status: "modified", statusRaw: "MODIFIED" }),
    ).toEqual({ path: "a.ts", status: "modified", additions: null, deletions: null });
  });
});
