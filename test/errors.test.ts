import { describe, it, expect } from "vite-plus/test";
import { FetchError } from "ofetch";
import {
  normalizeError,
  ForgesError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
} from "../src/errors.ts";

function createFetchError(
  message: string,
  status: number,
  responseHeaders?: Record<string, string>,
): FetchError {
  const error = new FetchError(message);
  error.status = status;
  error.statusCode = status;
  if (responseHeaders) {
    error.response = { headers: new Headers(responseHeaders) } as any;
  }
  return error;
}

describe("normalizeError", () => {
  it("maps 401 FetchError to AuthenticationError", () => {
    const err = createFetchError("Unauthorized", 401);
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(AuthenticationError);
    expect(result.status).toBe(401);
    expect(result.platform).toBe("github");
    expect(result.message).toContain("Authentication failed");
    expect(result.originalError).toBe(err);
  });

  it("maps 403 FetchError to PermissionError", () => {
    const err = createFetchError("Forbidden", 403);
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(PermissionError);
    expect(result.status).toBe(403);
    expect(result.platform).toBe("github");
    expect(result.message).toContain("Permission denied");
    expect(result.originalError).toBe(err);
  });

  it("maps 403 with x-ratelimit-remaining 0 to RateLimitError", () => {
    const err = createFetchError("Forbidden", 403, {
      "x-ratelimit-remaining": "0",
    });
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.status).toBe(429);
    expect(result.message).toContain("Rate limit exceeded");
  });

  it("maps 403 with Retry-After header to RateLimitError", () => {
    const err = createFetchError("Forbidden", 403, {
      "Retry-After": "120",
    });
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(RateLimitError);
    expect((result as RateLimitError).retryAfter).toBe(120);
  });

  it("maps 403 with rate limit message to RateLimitError", () => {
    const err = createFetchError("API rate limit exceeded", 403);
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.message).toContain("Rate limit exceeded");
  });

  it("maps 404 FetchError to NotFoundError", () => {
    const err = createFetchError("Not Found", 404);
    const result = normalizeError(err, "gitea");

    expect(result).toBeInstanceOf(NotFoundError);
    expect(result.status).toBe(404);
    expect(result.platform).toBe("gitea");
    expect(result.message).toContain("Resource not found");
  });

  it("maps 429 FetchError to RateLimitError with retryAfter", () => {
    const err = createFetchError("Too Many Requests", 429, { "Retry-After": "60" });
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.status).toBe(429);
    expect(result.message).toContain("Rate limit exceeded");
    expect((result as RateLimitError).retryAfter).toBe(60);
  });

  it("maps 429 with whitespace-wrapped numeric Retry-After", () => {
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": " 60 ",
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBe(60);
  });

  it("maps 429 FetchError without Retry-After header", () => {
    const err = createFetchError("Too Many Requests", 429);
    const result = normalizeError(err, "gitlab");

    expect(result).toBeInstanceOf(RateLimitError);
    expect((result as RateLimitError).retryAfter).toBeUndefined();
  });

  it("maps 429 with HTTP-date Retry-After to delay seconds", () => {
    const futureDate = new Date(Date.now() + 120_000).toUTCString();
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": futureDate,
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeTypeOf("number");
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(120);
  });

  it("maps 429 with past HTTP-date Retry-After to zero", () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": pastDate,
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBe(0);
  });

  it("maps 429 with whitespace-wrapped HTTP-date Retry-After", () => {
    const futureDate = new Date(Date.now() + 120_000).toUTCString();
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": ` ${futureDate} `,
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeTypeOf("number");
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(120);
  });

  it("maps 429 with non-numeric Retry-After to undefined", () => {
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": "not-a-number",
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it("maps 429 with partially numeric Retry-After to undefined", () => {
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": "60s",
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it("maps 429 with exponent-like Retry-After to undefined", () => {
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": "1e3",
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it("maps 429 with comma-formatted Retry-After to undefined", () => {
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": "10,000",
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it("maps 429 with negative Retry-After to undefined", () => {
    const err = createFetchError("Too Many Requests", 429, {
      "Retry-After": "-5",
    });
    const result = normalizeError(err, "github") as RateLimitError;

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.retryAfter).toBeUndefined();
  });

  it("maps other HTTP status to generic ForgesError", () => {
    const err = createFetchError("Internal Server Error", 500);
    const result = normalizeError(err, "github");

    expect(result).toBeInstanceOf(ForgesError);
    expect(result).not.toBeInstanceOf(AuthenticationError);
    expect(result).not.toBeInstanceOf(NotFoundError);
    expect(result).not.toBeInstanceOf(RateLimitError);
    expect(result.status).toBe(500);
  });

  it("wraps generic Error in ForgesError", () => {
    const err = new Error("Network failure");
    const result = normalizeError(err, "gitea");

    expect(result).toBeInstanceOf(ForgesError);
    expect(result.message).toBe("Network failure");
    expect(result.status).toBeUndefined();
    expect(result.originalError).toBe(err);
  });

  it("passes through existing ForgesError unchanged", () => {
    const original = new NotFoundError("Already normalized", "github");
    const result = normalizeError(original);

    expect(result).toBe(original);
  });

  it("converts unknown error types to ForgesError", () => {
    const result = normalizeError("string error", "github");

    expect(result).toBeInstanceOf(ForgesError);
    expect(result.message).toBe("string error");
    expect(result.platform).toBe("github");
  });
});

describe("normalizeError provider reasons", () => {
  function rejected(status: number, statusText: string, data: unknown): FetchError {
    const err = createFetchError(
      `[GET] "https://forge.example/api/resource": ${status} ${statusText}`,
      status,
    );
    err.statusText = statusText;
    err.data = data;
    return err;
  }

  it("keeps the reason Gitea gives for an unknown owner", () => {
    const result = normalizeError(
      rejected(400, "Bad Request", {
        message: "user does not exist [uid: 0, name: nonexistent-owner-zq9]",
        url: "https://gitea.com/api/swagger",
      }),
      "gitea",
    );

    expect(result.status).toBe(400);
    expect(result.message).toBe(
      '[GET] "https://forge.example/api/resource": 400 Bad Request: user does not exist [uid: 0, name: nonexistent-owner-zq9]',
    );
  });

  it("names the fields behind GitHub's Validation Failed", () => {
    const result = normalizeError(
      rejected(422, "", {
        message: "Validation Failed",
        errors: [{ value: "bogus", resource: "Issue", field: "state", code: "invalid" }],
        documentation_url: "https://docs.github.com/v3/issues/#list-issues",
        status: "422",
      }),
      "github",
    );

    expect(result.message).toBe(
      '[GET] "https://forge.example/api/resource": 422: Validation Failed: state invalid',
    );
  });

  it("prefers the message of a custom GitHub validation error", () => {
    const result = normalizeError(
      rejected(422, "Unprocessable Entity", {
        message: "Validation Failed",
        errors: [
          { resource: "PullRequest", code: "custom", message: "A pull request already exists" },
          "base is invalid",
        ],
      }),
      "github",
    );

    expect(result.message).toMatch(
      /: Validation Failed: A pull request already exists; base is invalid$/,
    );
  });

  it("reads GitLab's error field and its field map", () => {
    expect(
      normalizeError(
        rejected(400, "Bad Request", { error: "state does not have a valid value" }),
        "gitlab",
      ).message,
    ).toMatch(/400 Bad Request: state does not have a valid value$/);

    expect(
      normalizeError(
        rejected(400, "Bad Request", {
          message: { title: ["can't be blank"], labels: ["is invalid", "is too long"] },
        }),
        "gitlab",
      ).message,
    ).toMatch(/400 Bad Request: title can't be blank; labels is invalid; is too long$/);
  });

  it("keeps the reason after the class prefix", () => {
    const result = normalizeError(
      rejected(404, "Not Found", { message: "404 Project Not Found" }),
      "gitlab",
    );

    expect(result).toBeInstanceOf(NotFoundError);
    expect(result.message).toBe(
      'Resource not found: [GET] "https://forge.example/api/resource": 404 Not Found: 404 Project Not Found',
    );
  });

  it("leaves out a reason the status already says", () => {
    const result = normalizeError(
      rejected(404, "Not Found", { message: "Not Found", documentation_url: "https://docs" }),
      "github",
    );

    expect(result.message).toBe(
      'Resource not found: [GET] "https://forge.example/api/resource": 404 Not Found',
    );
    expect(
      normalizeError(rejected(404, "Not Found", { message: "404 not found" }), "gitea").message,
    ).toMatch(/: 404 Not Found$/);
  });

  it("gives the status alone for an HTML, text or empty body", () => {
    for (const data of [
      "<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>",
      "upstream connect error",
      undefined,
      {},
      { message: "" },
      [{ message: "array bodies are not error objects" }],
    ]) {
      expect(normalizeError(rejected(502, "Bad Gateway", data), "gitea").message).toBe(
        '[GET] "https://forge.example/api/resource": 502 Bad Gateway',
      );
    }
  });

  it("cuts a long reason to one bounded line", () => {
    const result = normalizeError(
      rejected(500, "Internal Server Error", { message: `first\n\tline ${"x".repeat(500)}` }),
      "gitea",
    );
    const reason = result.message.split("500 Internal Server Error: ")[1] ?? "";

    expect(reason).toHaveLength(200);
    expect(reason.startsWith("first line x")).toBe(true);
    expect(reason.endsWith("…")).toBe(true);
  });

  it("masks the caller's address in GitHub's rate limit text", () => {
    const result = normalizeError(
      rejected(403, "Forbidden", {
        message:
          "API rate limit exceeded for 104.28.193.185. (But here's the good news: Authenticated requests get a higher rate limit.)",
      }),
      "github",
    );

    expect(result).toBeInstanceOf(RateLimitError);
    expect(result.message).not.toContain("104.28.193.185");
    expect(result.message).toContain("API rate limit exceeded for <address>.");

    const v6 = normalizeError(
      rejected(403, "Forbidden", { message: "API rate limit exceeded for 2001:db8::1." }),
      "github",
    );
    expect(v6.message).toContain("exceeded for <address>.");
  });

  it("keeps times and Ruby constants that look like addresses", () => {
    const result = normalizeError(
      rejected(500, "Internal Server Error", {
        message: "Gitlab::Git::CommandError at 12:30:45",
      }),
      "gitlab",
    );

    expect(result.message).toMatch(/: Gitlab::Git::CommandError at 12:30:45$/);
  });

  it("keeps a reason that happens to appear in the URL", () => {
    const result = normalizeError(rejected(410, "Gone", { message: "resource" }), "gitea");

    expect(result.message).toMatch(/410 Gone: resource$/);
  });

  it("turns controls and directional marks into spaces", () => {
    const result = normalizeError(
      rejected(400, "Bad Request", { message: "bad\u001b]0;title\u0007 input\u202eflip" }),
      "gitea",
    );

    expect(result.message).toMatch(/400 Bad Request: bad ]0;title input flip$/);
  });

  it("reads only the first items of a huge or nested body", () => {
    const nested: Record<string, unknown> = {};
    let level = nested;
    for (let depth = 0; depth < 10_000; depth++) {
      level.inner = {};
      level = level.inner as Record<string, unknown>;
    }
    const result = normalizeError(
      rejected(400, "Bad Request", {
        message: { ...nested, title: Array.from({ length: 100_000 }, () => "is invalid") },
      }),
      "gitlab",
    );

    expect(result.message).toMatch(
      /400 Bad Request: title is invalid; is invalid; is invalid; is invalid; is invalid$/,
    );

    const fields = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`f${i}`, ["x"]]));
    expect(
      normalizeError(rejected(400, "Bad Request", { message: fields }), "gitlab").message,
    ).toMatch(/400 Bad Request: f0 x; f1 x; f2 x; f3 x; f4 x$/);
  });

  it("joins GitLab's OAuth error with its description", () => {
    const result = normalizeError(
      rejected(401, "Unauthorized", {
        error: "invalid_token",
        error_description: "Token was revoked. You have to re-authorize from the user.",
      }),
      "gitlab",
    );

    expect(result.message).toMatch(
      /401 Unauthorized: invalid_token: Token was revoked\. You have to re-authorize from the user\.$/,
    );
    expect(
      normalizeError(
        rejected(400, "Bad Request", { message: "Validation Failed", error: "Validation Failed" }),
        "gitlab",
      ).message,
    ).toMatch(/400 Bad Request: Validation Failed$/);
  });

  it("never keeps half of an address or credential the cut split", () => {
    const shifted = normalizeError(
      rejected(403, "Forbidden", {
        message: `${"\t".repeat(700)}${"x".repeat(93)} 104.28.193.185`,
      }),
      "github",
    );
    expect(shifted.message).not.toMatch(/\b104\b/);

    const behindCredentials = normalizeError(
      rejected(403, "Forbidden", {
        message: `https://${"a".repeat(1500)}@h ${"x".repeat(85)} 104.28.193.185`,
      }),
      "github",
    );
    expect(behindCredentials.message).toMatch(/: https:\/\/h x+$/);

    const longSecret = normalizeError(
      rejected(502, "Bad Gateway", {
        message: `mirror https://ci:${"s".repeat(2000)}@host failed`,
      }),
      "gitea",
    );
    expect(longSecret.message).toMatch(/502 Bad Gateway: mirror$/);
  });

  it("reads a bounded start of a huge field", () => {
    const result = normalizeError(
      rejected(400, "Bad Request", { message: `${" ".repeat(5_000_000)}hidden reason` }),
      "gitea",
    );

    expect(result.message).toMatch(/: 400 Bad Request$/);
  });

  it("never cuts an emoji in half", () => {
    const result = normalizeError(
      rejected(400, "Bad Request", { message: `${"x".repeat(198)}😀${"y".repeat(10)}` }),
      "gitea",
    );

    expect(result.message.isWellFormed()).toBe(true);
    expect(result.message).toMatch(/: x{198}…$/);
  });

  it("drops credentials from a URL in the reason", () => {
    const result = normalizeError(
      rejected(502, "Bad Gateway", {
        message: "mirror https://ci:s3cret@git.example.com/repo.git failed",
      }),
      "gitea",
    );

    expect(result.message).not.toContain("s3cret");
    expect(result.message).toMatch(/: mirror https:\/\/git\.example\.com\/repo\.git failed$/);
  });

  it("detects a secondary rate limit from the body alone", () => {
    const result = normalizeError(
      rejected(403, "Forbidden", {
        message: "You have exceeded a secondary rate limit. Please wait a few minutes.",
      }),
      "github",
    );

    expect(result).toBeInstanceOf(RateLimitError);
  });
});
