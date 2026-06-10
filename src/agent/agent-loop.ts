import { AssistantMessage, Message, ToolCall, ToolResultMessage } from "../core/extensions/types";
import { AgentContext, AgentLoopConfig, Context } from "./types";

export async function agentLoop(
    prompts: Message[],
    context: AgentContext,
    config: AgentLoopConfig,
    signal?: AbortSignal
) {
    const newMessages: Message[] = [...prompts];
    await runLoop(context, config, newMessages, signal);
    console.log(JSON.stringify(newMessages, null, "  "));
}

function convertToLlm(messages: Message[]): Message[] | Promise<Message[]> {
    return messages;
}

export function NewAgentLoopConfig(): AgentLoopConfig {
    return {
        convertToLlm: convertToLlm,
    };
}

async function runLoop(
    initialContext: AgentContext,
    config: AgentLoopConfig,
    newMessages: Message[],
    signal: AbortSignal | undefined,
): Promise<void> {
    let currentContext = initialContext;
    while (true) {
        let hasMoreToolCalls = true;
        while (hasMoreToolCalls) {
            const message = await streamAssistantResponse(currentContext, config, signal);
            newMessages.push(message);

            if (message.stopReason == "error" || message.stopReason == "aborted") {
                return;
            }

            const toolCalls = message.content.filter((c): c is ToolCall => c.type == "toolCall");

            const toolResults: ToolResultMessage[] = [];
            hasMoreToolCalls = false;

            if (toolCalls.length > 0) {
                const executedToolBatch = await executeToolCalls(currentContext, toolCalls, signal);
                hasMoreToolCalls = !executedToolBatch.terminate;
                toolResults.push(...executedToolBatch.messages);
                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }
        }
        break;
    }
}

async function streamAssistantResponse(
    context: AgentContext,
    config: AgentLoopConfig,
    signal?: AbortSignal,
): Promise<AssistantMessage> {
    const llmMessages = await config.convertToLlm(context.messages);
    const llmContext: Context = {
        systemPrompts: context.systemPrompt,
        messages: llmMessages,
        tool: context.tools,
    };
    return context.complete(context.messages, context.tools ?? [], signal);
}

type ExecutedToolCallBatch = {
    messages: ToolResultMessage[];
    terminate: boolean;
};

async function executeToolCalls(
    context: AgentContext,
    toolCalls: ToolCall[],
    signal: AbortSignal | undefined,
): Promise<ExecutedToolCallBatch> {
    const messages: ToolResultMessage[] = [];
    let terminate = false;

    for (const call of toolCalls) {
        const tool = context.tools?.find(t => t.name === call.name);
        if (!tool) {
            messages.push({
                role: "toolResult",
                toolCallId: call.id,
                toolName: call.name,
                content: [{ type: "text", text: `Unknown tool: ${call.name}` }],
                isError: true,
                timestamp: Date.now(),
            });
            continue;
        }
        try {
            const result = await tool.exectue(call.id, call.arguments, signal);
            if (result.terminate) terminate = true;
            messages.push({
                role: "toolResult",
                toolCallId: call.id,
                toolName: call.name,
                content: result.content,
                details: result.details,
                isError: false,
                timestamp: Date.now(),
            });
        } catch (e: any) {
            messages.push({
                role: "toolResult",
                toolCallId: call.id,
                toolName: call.name,
                content: [{ type: "text", text: e.message ?? String(e) }],
                isError: true,
                timestamp: Date.now(),
            });
        }
    }

    return { messages, terminate };
}