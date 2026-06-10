import type { Static, TSchema } from "typebox";

export interface TextContent {
    type: "text";
    text: string;
}

export interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
    role: "user";
    content: string | (TextContent | ImageContent)[];
    timestamp: number;
}

export interface ThinkingContent {
    type: "thinking";
    thinking: string;
}

export interface AssistantMessage {
    role: "assistant";
    content: (TextContent | ToolCall)[];
    timestamp: number;
    stopReason: StopReason;
}

export interface ToolResultMessage<TDetails = any> {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: (TextContent | ImageContent | ThinkingContent)[]; // Supports text and images
    details?: TDetails;
    isError: boolean;
    timestamp: number; // Unix timestamp in milliseconds
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface ToolCall {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface Tool<TParameters extends TSchema = TSchema> {
    name: string,
    description: string,
    parameters: TParameters;
}

export interface AgentToolResult<T> {
    content: (TextContent | ImageContent)[];
    details: T;
    terminate?: boolean;
}

export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
    label: string;
    exectue: (
        toolCallId: string,
        params: Static<TParameters>,
        signal?: AbortSignal,
    ) => Promise<AgentToolResult<TDetails>>;
}

export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
    name: string;
    label: string;
    description: string;
    parameteres: TParams;
    execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined): Promise<AgentToolResult<TDetails>>;
}

type AnyToolDefinition = ToolDefinition<any, any, any>;


export function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
    tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition {
    return tool as ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition;
}