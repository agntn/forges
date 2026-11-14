/** AI SDK tools over the same definitions MCP, Pi, OMP and the CLI read. */

import { toAiTools } from "@agntn/tools/ai";
import type { Tool } from "ai";

import type { ForgesToolName } from "../extensions/shared/tool-effects.ts";
import { forgesTools } from "./tools.ts";

export type { ForgesToolName };

/** Every forges tool for the AI SDK. Writes ask first, unless your `toolApproval` says otherwise. */
export const forgesAiTools: Readonly<Record<ForgesToolName, Tool>> =
  /* @__PURE__ */ askBeforeWrites();

/** The tool map, with `needsApproval` on every tool whose effect isn't a read. */
function askBeforeWrites(): Record<ForgesToolName, Tool> {
  const definitions = forgesTools();
  const tools: Readonly<Record<string, Tool>> = toAiTools(definitions);
  return Object.fromEntries(
    definitions.map(({ name, effect }) => {
      const tool = tools[name];
      return [name, effect === "read" ? tool : { ...tool, needsApproval: true }];
    }),
  ) as Record<ForgesToolName, Tool>;
}
