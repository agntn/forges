import { fetchAllPages, GixaError, paginate } from "gixa";

type Repo = { id: number; name: string };

function isRepo(value: unknown): value is Repo {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { id?: unknown; name?: unknown };
  return typeof candidate.id === "number" && typeof candidate.name === "string";
}

async function githubFetcher(url: string): Promise<{ data: Repo[]; headers: Headers }> {
  const token = process.env.GITHUB_TOKEN;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gixa-example",
      ...(token ? { Authorization: `token ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new GixaError(`GitHub request failed with status ${response.status}`, response.status, "github");
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || !payload.every(isRepo)) {
    throw new Error("GitHub response payload is not a repository list");
  }

  const data = payload;
  return { data, headers: response.headers };
}

async function main(): Promise<void> {
  const firstThreePages: Repo[] = [];

  for await (const page of paginate(githubFetcher, "https://api.github.com/orgs/unjs/repos", {
    perPage: 10,
    maxPages: 3,
  })) {
    firstThreePages.push(...page);
  }

  console.log("paged count", firstThreePages.length);

  const cappedAll = await fetchAllPages(githubFetcher, "https://api.github.com/orgs/unjs/repos", {
    perPage: 20,
    maxPages: 2,
  });

  console.log("fetchAllPages count", cappedAll.length);
}

main().catch((error: unknown) => {
  if (error instanceof GixaError) {
    console.error("gixa error", { message: error.message, status: error.status, platform: error.platform });
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
