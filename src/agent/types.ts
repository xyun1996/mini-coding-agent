import { AgentTool, AssistantMessage, Message } from "../core/extensions/types";
import { Tool } from "../tools";


export interface LLMComplete {
    (messages: Message[], tools: AgentTool<any>[], signal?: AbortSignal): Promise<AssistantMessage>;
}

export interface AgentContext {
    systemPrompt: string;
    messages: Message[];
    tools?: AgentTool<any>[];
    complete: LLMComplete;
}

export interface AgentLoopConfig {
    convertToLlm: (messages: Message[]) => Message[] | Promise<Message[]>;
}

export interface Context {
    systemPrompts?: string;
    messages: Message[];
    tool?: Tool[];
}