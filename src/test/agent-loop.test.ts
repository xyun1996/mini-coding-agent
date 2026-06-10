import { describe, test } from "vitest";
import { agentLoop, NewAgentLoopConfig } from "../agent/agent-loop";
import { Message } from "../core/extensions/types"
import { AgentContext, AgentLoopConfig } from "../agent/types";
import { createMockLLM } from "../agent/mock-llm";
import { createTool } from "../tools/index.ts"


describe("agent-loop", () => {
    test("agentLoop", async () => {
        // const prompts: Message[] = [];
        // prompts.push({ role: "user", content: "hello", timestamp: Date.now() });
        // let agentContext: AgentContext = {
        //     systemPrompt: "",
        //     messages: [],
        //     tools: [],
        //     complete: createMockLLM(),
        // };
        // agentContext.tools?.push(createTool("ls", "."));
        // const agentConfig = NewAgentLoopConfig();
        // await agentLoop(prompts, agentContext, agentConfig);
        console.log(`${process.env.ProgramFiles}\\Powershell\\7\\pwsh.exe`);
        console.log(`${process.env.SystemRoot}\\System32\\cmd.exe`)
    })
});