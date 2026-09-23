import { createServer } from "node:http";

import { describe, expect, it } from "vite-plus/test";

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

  it("retries safe reads without repeating payload requests", async () => {
    const hits = new Map<string, number>();
    const server = createServer((request, response) => {
      const method = request.method ?? "";
      hits.set(method, (hits.get(method) ?? 0) + 1);
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"retry probe"}');
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
        token: "",
      });
      const methods = ["GET", "PATCH", "POST", "PUT", "DELETE"] as const;
      for (const method of methods) {
        await expect(client("/", { method, retryDelay: 0 })).rejects.toThrow();
      }

      expect(hits.get("GET")).toBe(3);
      for (const method of methods.slice(1)) {
        expect(hits.get(method)).toBe(1);
      }

      hits.clear();
      const request = new Request(`http://127.0.0.1:${address.port}`, { method: "POST" });
      await expect(client(request, { retryDelay: 0 })).rejects.toThrow();
      expect(hits.get("POST")).toBe(1);

      hits.clear();
      await expect(client("/", { method: "POST", retry: 1, retryDelay: 0 })).rejects.toThrow();
      expect(hits.get("POST")).toBe(2);
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
