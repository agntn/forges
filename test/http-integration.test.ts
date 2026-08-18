import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { createHttpClient } from "../src/http.ts";

describe("createHttpClient with ofetch", () => {
  it("adds authentication through the real onRequest context", async () => {
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP server address");

      const client = createHttpClient({
        baseURL: `http://127.0.0.1:${address.port}`,
        token: "test-token",
      });
      await client("/");

      expect(authorization).toBe("token test-token");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
