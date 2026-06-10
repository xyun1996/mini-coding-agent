import { AgentTool, ToolDefinition } from "../core/extensions/types.ts";
import { BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createLsTool, createLsToolDefinition, LsToolDetails, LsToolOptions } from "./ls";

export {
    createBashTool,
    createBashToolDefinition,
    type BashOperations,
    type BashToolDetails,
    type BashToolInput,
    type BashToolOptions,
} from "./bash.ts";

export {
    createLsTool,
    createLsToolDefinition,
    type LsOperations,
    type LsToolDetails,
    type LsToolInput,
    type LsToolOptions,
} from "./ls.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

export interface ToolsOptions {
    ls?: LsToolOptions;
    bash?: BashToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
    switch (toolName) {
        case "ls":
            return createLsToolDefinition(cwd, options?.ls);
        case "bash":
            return createBashToolDefinition(cwd, options?.bash);
        default:
            throw new Error(`Unknown tool name: ${toolName}`);
    }
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
    switch (toolName) {
        case "ls":
            return createLsTool(cwd, options?.ls);
        case "bash":
            return createBashTool(cwd, options?.bash);
        default:
            throw new Error(`Unknown tool name: ${toolName}`);
    }
}