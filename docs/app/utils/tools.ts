import { toolEffects } from "../../../packages/shared/tool-effects";

const effects = Object.values(toolEffects);

/** Every agent tool, counted from the table the MCP server and both extensions share. */
export const AGENT_TOOLS = effects.length;

/** Tools that write to the forge; reloading a credential changes local state only. */
export const WRITE_TOOLS = effects.filter((effect) => effect.startsWith("remote")).length;
