import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerOmpTools, type OmpRenderers } from "@agntn/tools/omp";

import type * as ForgesToolList from "../../../dist/tools.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../../shared/tui.ts";

/** Source in a checkout, the build in the package; both imports stay literal for OMP to see. */
async function loadTools(): Promise<typeof ForgesToolList> {
  const sourceModulePath = fileURLToPath(new URL("../../../src/tools.ts", import.meta.url));
  return existsSync(sourceModulePath)
    ? ((await import("../../../src/tools.ts")) as unknown as typeof ForgesToolList)
    : ((await import("../../../dist/tools.mjs")) as typeof ForgesToolList);
}

/** Registers the forges tools; the host validates the same schemas MCP and Pi do. */
export default async function forgesOmpExtension(pi: ExtensionAPI): Promise<void> {
  const { Text } = pi.pi;
  pi.setLabel("Forges");

  function statusRenderers(name: string, title: string): OmpRenderers {
    return {
      renderCall(args: unknown, options: RenderOptions, theme: StatusTheme) {
        return new Text(renderToolCall(name, title, args, options, theme), 0, 0);
      },
      renderResult(result: RenderedToolResult, options: RenderOptions, theme: StatusTheme) {
        return new Text(
          renderToolResult(name, result, result.isError === true, options, theme),
          0,
          0,
        );
      },
    };
  }

  const tools = (await loadTools()).forgesTools();
  registerOmpTools(pi, tools, {
    Text,
    renderers: Object.fromEntries(
      tools.map((tool) => [tool.name, statusRenderers(tool.name, tool.title)]),
    ),
  });
}
