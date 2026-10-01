import { defineConfig } from "vite-plus";

export default defineConfig({
  /**
   * One tsconfig for every transformed file. `test/docs-query.test.ts` loads a docs module, and
   * `docs/tsconfig.json` extends `.nuxt` files that exist only after the docs install, which CI skips.
   */
  tsconfig: "tsconfig.json",
  fmt: {
    ignorePatterns: ["dist", "CHANGELOG.md"],
  },
  lint: {
    plugins: ["unicorn", "typescript", "oxc"],
    ignorePatterns: ["dist"],
  },
  test: {
    environment: "node",
    globals: true,
    /* The docs worker bundles the library from `src/`, and so does a test that loads a docs module. */
    alias: { "@agntn/forges": new URL("src/index.ts", import.meta.url).pathname },
  },
});
