/**
 * Records the landing samples through the built library (dist/index.mjs). Run from docs/: `node scripts/record-fixtures.mjs`.
 * GitHub uses the local gh token (threads need GraphQL); GitLab and Codeberg are anonymous.
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createProvider } from "../../dist/index.mjs";

const OUT = process.argv[2];
const cut = (value, max) => {
  const points = [...value];
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : value;
};
const firstLine = (value) => value.split(/\r?\n/u, 1)[0]?.trim() ?? "";

const ghToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

const TARGETS = [
  { platform: "github", owner: "nitrojs", repo: "nitro", token: ghToken },
  { platform: "gitlab", owner: "gitlab-org", repo: "cli", token: "" },
  {
    platform: "gitea",
    owner: "forgejo",
    repo: "forgejo",
    baseURL: "https://codeberg.org",
    token: "",
  },
];

function slimIssue(issue) {
  return {
    number: issue.number,
    title: cut(issue.title, 120),
    state: issue.state,
    labels: issue.labels.slice(0, 4),
    author: issue.author.login,
    createdAt: issue.createdAt,
    url: issue.url,
  };
}

function slimPull(pr) {
  return {
    ...slimIssue(pr),
    draft: pr.draft,
    merged: pr.merged,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    headSha: pr.headSha,
    mergeable: pr.mergeable,
  };
}

function slimCommit(commit) {
  return {
    sha: commit.sha,
    message: cut(firstLine(commit.message), 100),
    author: { name: commit.author.name, date: commit.author.date },
    parents: commit.parents.length,
    url: commit.url,
  };
}

function slimThread(thread) {
  return {
    id: thread.id,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    path: thread.path,
    line: thread.line,
    comments: thread.comments.slice(0, 2).map((comment) => ({
      author: comment.author.login,
      body: cut(comment.body.replace(/\s+/gu, " ").trim(), 180),
      createdAt: comment.createdAt,
    })),
  };
}

async function settle(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    console.error("  skipped:", error.message);
    return fallback;
  }
}

const samples = [];
for (const target of TARGETS) {
  console.error(`${target.platform} ${target.owner}/${target.repo}`);
  const provider = createProvider(target.platform, {
    token: target.token,
    baseURL: target.baseURL,
    cache: { enabled: false },
  });
  const repository = await provider.repos.get(target.owner, target.repo);
  const issues = await settle(
    provider.issues.list(target.owner, target.repo, { state: "open", perPage: 5 }),
    { items: [], hasNextPage: false },
  );
  const pulls = await settle(
    provider.pullRequests.list(target.owner, target.repo, { state: "open", perPage: 5 }),
    { items: [], hasNextPage: false },
  );
  const commits = await settle(provider.commits.list(target.owner, target.repo, { perPage: 5 }), {
    items: [],
    hasNextPage: false,
  });
  const ci = await settle(provider.ciRuns.list(target.owner, target.repo, { perPage: 5 }), {
    items: [],
    hasNextPage: false,
  });

  let threads = { number: null, items: [] };
  for (const pr of pulls.items) {
    const page = await settle(
      provider.threads.list(target.owner, target.repo, pr.number, { perPage: 4, state: "all" }),
      null,
    );
    if (page && page.items.length > 0) {
      threads = { number: pr.number, items: page.items.slice(0, 2).map(slimThread) };
      break;
    }
  }

  samples.push({
    platform: target.platform,
    owner: target.owner,
    repo: target.repo,
    baseURL: target.baseURL ?? null,
    host: target.baseURL
      ? new URL(target.baseURL).hostname
      : target.platform === "github"
        ? "github.com"
        : "gitlab.com",
    repository: {
      ...repository,
      description: cut(repository.description, 160),
      viewerPermission: null,
    },
    issues: {
      items: issues.items.map(slimIssue),
      hasNextPage: issues.hasNextPage,
      totalCount: issues.totalCount ?? null,
    },
    pullRequests: { items: pulls.items.map(slimPull), hasNextPage: pulls.hasNextPage },
    commits: commits.items.map(slimCommit),
    ciRuns: ci.items.map((run) => ({
      id: run.id,
      branch: run.branch,
      revision: run.revision,
      status: run.status,
      conclusion: run.conclusion,
      url: run.url,
    })),
    threads,
    live: false,
  });
}

writeFileSync(OUT, JSON.stringify(samples, null, 2));
console.error(`wrote ${OUT}`);
