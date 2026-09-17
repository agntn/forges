import { describe, expect, it } from "vitest";

import { isPullRequestReview, normalizeReviewState } from "../src/review.ts";

describe("normalizeReviewState", () => {
  it.each([
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "changes_requested"],
    ["REQUEST_CHANGES", "changes_requested"],
    ["requested_changes", "changes_requested"],
    ["COMMENTED", "commented"],
    ["COMMENT", "commented"],
    ["reviewed", "commented"],
    ["DISMISSED", "dismissed"],
    ["unapproved", "dismissed"],
    ["PENDING", "pending"],
    ["review_started", "pending"],
  ] as const)("maps %s to %s", (raw, state) => {
    expect(normalizeReviewState(raw)).toBe(state);
  });

  it.each(["REQUEST_REVIEW", "unreviewed"])("drops the unanswered request %s", (raw) => {
    expect(normalizeReviewState(raw)).toBeNull();
    expect(normalizeReviewState(raw, true)).toBeNull();
  });

  it("lets a dismissed flag override the recorded verdict", () => {
    expect(normalizeReviewState("REQUEST_CHANGES", true)).toBe("dismissed");
  });

  it("reports a state it does not know as a comment", () => {
    expect(normalizeReviewState("strongly_worded")).toBe("commented");
  });
});

describe("isPullRequestReview", () => {
  it("keeps reviews and drops the null a mapper returns for a request", () => {
    const review = {
      id: "1",
      state: "approved" as const,
      body: "",
      author: { login: "lunny" },
      revision: "",
      submittedAt: "",
      url: "",
    };
    expect([review, null].filter(isPullRequestReview)).toEqual([review]);
  });
});
