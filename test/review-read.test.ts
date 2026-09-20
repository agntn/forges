import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchError } from "ofetch";
import { GitHubProvider } from "../src/providers/github.ts";
import { GiteaProvider } from "../src/providers/gitea.ts";
import { GitLabProvider } from "../src/providers/gitlab.ts";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rawFetch: vi.fn() }));
vi.mock("../src/http.ts", () => ({
  createHttpClient: () => mocks.client,
  rawFetch: mocks.rawFetch,
  FetchError,
}));

const body = `${"Review context\n".repeat(20)}Add the confirmation description to the example.`;
const rawReview = {
  id: 123,
  state: "APPROVED",
  body,
  user: { login: "reviewer" },
  commit_id: "abc123",
  submitted_at: "2026-09-20T19:00:00Z",
  html_url: "https://example.com/owner/repo/pull/5#pullrequestreview-123",
};

beforeEach(() => vi.resetAllMocks());

function missingReview() {
  const error = new FetchError("Not Found");
  Object.defineProperty(error, "status", { value: 404 });
  return error;
}

describe.each([
  ["github", GitHubProvider],
  ["gitea", GiteaProvider],
] as const)("%s single review", (platform, Constructor) => {
  it("reads the complete review and refreshes a later dismissal", async () => {
    const provider = new Constructor({ token: "" });
    mocks.client.mockResolvedValueOnce(rawReview).mockResolvedValueOnce({
      ...rawReview,
      state: platform === "github" ? "DISMISSED" : "APPROVED",
      dismissed: true,
    });
    expect(await provider.pullRequests.getReview("owner", "repo", 5, "123")).toEqual({
      id: "123",
      state: "approved",
      body,
      author: { login: "reviewer" },
      revision: "abc123",
      submittedAt: rawReview.submitted_at,
      url: rawReview.html_url,
    });
    expect((await provider.pullRequests.getReview("owner", "repo", 5, "123")).state).toBe(
      "dismissed",
    );
    expect(mocks.client).toHaveBeenCalledTimes(2);
    expect(mocks.client).toHaveBeenCalledWith("/repos/owner/repo/pulls/5/reviews/123");
  });

  it("encodes each path segment", async () => {
    mocks.client.mockResolvedValue(rawReview);
    await new Constructor({ token: "" }).pullRequests.getReview("owner", "repo", 5, "123?x=1");
    expect(mocks.client).toHaveBeenCalledWith("/repos/owner/repo/pulls/5/reviews/123%3Fx%3D1");
  });

  it("normalizes a missing review without returning an empty one", async () => {
    mocks.client.mockRejectedValue(missingReview());
    await expect(
      new Constructor({ token: "" }).pullRequests.getReview("owner", "repo", 5, "123"),
    ).rejects.toMatchObject({ status: 404, platform });
  });

  it("rejects unanswered review requests instead of substituting a review", async () => {
    mocks.client.mockResolvedValue({ ...rawReview, state: "REQUEST_REVIEW" });
    await expect(
      new Constructor({ token: "" }).pullRequests.getReview("owner", "repo", 5, "123"),
    ).rejects.toMatchObject({ status: 501, platform });
  });
});

it("reports GitBucket's missing reviews route as unsupported", async () => {
  mocks.client.mockRejectedValue(missingReview());
  mocks.rawFetch.mockResolvedValue({ headers: new Headers() });
  const provider = new GitHubProvider({ token: "", baseURL: "https://gitbucket.example/api/v3" });
  await expect(provider.pullRequests.getReview("owner", "repo", 5, "123")).rejects.toMatchObject({
    status: 501,
    platform: "github",
  });
});

it("does not mistake a GitLab reviewer user id for a review id", async () => {
  await expect(
    new GitLabProvider({ token: "" }).pullRequests.getReview("owner", "repo", 5, "123"),
  ).rejects.toMatchObject({ status: 501, platform: "gitlab" });
  expect(mocks.client).not.toHaveBeenCalled();
});
