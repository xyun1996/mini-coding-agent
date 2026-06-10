import { AgentTool, ToolDefinition } from "../core/extensions/types";

export function wrapToolDefintion<TDetails = unknown>(
    definition: ToolDefinition<any, TDetails>,
): AgentTool<any, TDetails> {
    return {
        name: definition.name,
        label: definition.label,
        description: definition.description,
        parameters: definition.parameteres,
        exectue: (toolCallId, params, signal) =>
            definition.execute(toolCallId, params, signal),
    }
}