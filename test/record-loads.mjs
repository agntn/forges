import { Buffer } from "node:buffer";
import { registerHooks } from "node:module";

/**
 * Every module Node loads after this file evaluates. `source` is kept only for
 * files under the prefix given to `recordSourcesUnder`, so a test can match a
 * module by what it declares instead of by a chunk name the bundler may change.
 *
 * The packed-extension evaluation imports this file first; a child process gets
 * it through `--import`, where FORGES_REPORT_LOADS makes it print the list on exit.
 */
export const loaded = [];
let sourceRoot;

export function recordSourcesUnder(urlPrefix) {
  sourceRoot = urlPrefix;
}

function text(source) {
  if (typeof source === "string") return source;
  if (source === undefined || source === null) return undefined;
  return Buffer.from(source).toString();
}

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    const source = sourceRoot && url.startsWith(sourceRoot) ? text(result.source) : undefined;
    loaded.push({ url, source });
    return result;
  },
});

if (process.env.FORGES_REPORT_LOADS) {
  process.on("exit", () => {
    process.stderr.write(`\n@loaded ${JSON.stringify(loaded.map((module) => module.url))}\n`);
  });
}
