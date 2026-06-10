import { AgentTool, AssistantMessage, Message } from "../core/extensions/types";
import { LLMComplete } from "./types";

/**
 * Mock LLM that always calls the first available tool with empty arguments,
 * then returns a text stop on the next turn.
 */
export function createMockLLM(): LLMComplete {
    let callCount = 0;
    return (messages: Message[], tools: AgentTool<any>[], _signal?: AbortSignal): Promise<AssistantMessage> => {
        callCount++;
        if (tools.length > 0 && callCount <= 1) {
            const tool = tools[0];
            return Promise.resolve({
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: `mock-call-${callCount}`,
                        name: tool.name,
                        arguments: {},
                    },
                ],
                stopReason: "toolUse",
                timestamp: Date.now(),
            });
        }
        return Promise.resolve({
            role: "assistant",
            content: [{ type: "text", text: "Mock LLM response" }],
            stopReason: "stop",
            timestamp: Date.now(),
        });
    };
}

/**
 * Mock LLM driven by a script — each call returns the next entry in the script.
 * Script entries can be tool calls or text responses.
 */
export interface MockScriptEntry {
    toolCall?: { name: string; arguments: Record<string, any> };
    text?: string;
    stopReason?: "stop" | "toolUse" | "error";
}

export function createScriptedMockLLM(script: MockScriptEntry[]): LLMComplete {
    let index = 0;
    return (messages: Message[], _tools: AgentTool<any>[], _signal?: AbortSignal): Promise<AssistantMessage> => {
        const entry = script[Math.min(index, script.length - 1)];
        index++;
        const stopReason = entry.stopReason ?? (entry.toolCall ? "toolUse" : "stop");
        const content = entry.toolCall
            ? [{ type: "toolCall" as const, id: `mock-call-${index}`, name: entry.toolCall.name, arguments: entry.toolCall.arguments }]
            : [{ type: "text" as const, text: entry.text ?? "Mock response" }];
        return Promise.resolve({
            role: "assistant",
            content,
            stopReason,
            timestamp: Date.now(),
        });
    };
}
