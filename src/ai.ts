/** AI SDK tools over the same definitions MCP, Pi, OMP and the CLI read. */

import { toAiTools } from "@agntn/tools/ai";
import type { Tool } from "ai";

import type { ForgesToolName } from "../extensions/shared/tool-effects.ts";
import { forgesTools } from "./tools.ts";

export type { ForgesToolName };

/** Every forges tool for the AI SDK. Writes ask first, unless your `toolApproval` says otherwise. */
export const forgesAiTools = /* @__PURE__ */ toAiTools(forgesTools()) as Readonly<
  Record<ForgesToolName, Tool>
>;
