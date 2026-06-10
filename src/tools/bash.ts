import { SpawnOptions, ChildProcess } from "child_process";
import { GetShellConfig, GetShellConfigByType, GetShellDescription, ShellType, ShellConfig, SpawnShell, KillProcessTree, waitForChildProcess } from "../utils/shell"
import { Type, Static } from "typebox";
import { AgentTool, ToolDefinition } from "../core/extensions/types"
import { wrapToolDefintion } from "./tool-definition-wrappers";

const bashSchema = Type.Object({
    command: Type.String({ description: "The command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Maximum execution time in milliseconds (default: 120000)" })),
});

export type BashToolInput = Static<typeof bashSchema>;

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_LENGTH = 30_000;

export interface BashToolDetails {
    exitCode: number | null;
    truncated?: string;
}

export interface BashOperations {
    spawn: (config: ShellConfig, command: string, args: string[], options: SpawnOptions) => ChildProcess;
    getShellConfig: () => ShellConfig;
}

const DefaultBashOps: BashOperations = {
    spawn: SpawnShell,
    getShellConfig: GetShellConfig,
}

export interface BashToolOptions {
    operations?: BashOperations;
    maxOutputLength?: number;
    defaultTimeout?: number;
    shell?: ShellType;
}

export function createBashToolDefinition(
    cwd: string,
    options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined> {
    const ops = options?.operations ?? DefaultBashOps;
    const config = options?.shell ? GetShellConfigByType(options.shell) : ops.getShellConfig();
    const maxOutput = options?.maxOutputLength ?? MAX_OUTPUT_LENGTH;
    return {
        name: "bash",
        label: "bash",
        description: GetShellDescription(config.type),
        parameteres: bashSchema,
        async execute(
            _toolCallId,
            { command, timeout: timeoutMs }: BashToolInput,
            signal?: AbortSignal,
        ) {
            let stdout = "";
            let stderr = "";
            const handleStdout = (data: Buffer) => { stdout += data; };
            const handleStderr = (data: Buffer) => { stderr += data; };

            if (signal?.aborted) {
                throw new Error("Operation aborted");
            }
            if (!command.trim()) {
                throw new Error("empty command");
            }
            let timeoutHandle: NodeJS.Timeout | undefined;
            const child = ops.spawn(config, command, [], {
                cwd: cwd,
                detached: process.platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            })
            let timedOut = false;
            let aborted = false;
            const onAbort = () => {
                aborted = true;
                if (child.pid) KillProcessTree(child.pid);
            }
            try {
                child.stdout?.on("data", handleStdout);
                child.stderr?.on("data", handleStderr);
                const delay = timeoutMs ?? options?.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
                timeoutHandle = setTimeout(() => {
                    timedOut = true;
                    if (child.pid) KillProcessTree(child.pid);
                }, delay);
                if (signal) {
                    if (signal.aborted) onAbort();
                    else signal.addEventListener("abort", onAbort, { once: true });
                }
                const exitCode = await waitForChildProcess(child);

                if (aborted) {
                    throw new Error("Operation aborted");
                }

                // Truncate output if needed
                let truncated: string | undefined;
                if (stdout.length + stderr.length > maxOutput) {
                    // Truncate stderr first, keep the tail
                    if (stderr.length > maxOutput / 4) {
                        stderr = "...[truncated]...\n" + stderr.slice(-(Math.floor(maxOutput / 4)));
                        truncated = "stderr";
                    }
                    const remainingBudget = maxOutput - stderr.length;
                    if (stdout.length > remainingBudget) {
                        stdout = "...[truncated]...\n" + stdout.slice(-remainingBudget);
                        truncated = truncated ? "stdout+stderr" : "stdout";
                    }
                }

                // Build output text
                const parts: string[] = [];
                if (stdout) parts.push(stdout);
                if (stderr) {
                    if (parts.length > 0) parts.push("");
                    parts.push("[stderr]");
                    parts.push(stderr);
                }
                if (timedOut) {
                    if (parts.length > 0) parts.push("");
                    parts.push(`[Process timed out after ${delay}ms]`);
                }
                if (exitCode !== null && exitCode !== 0 && !timedOut) {
                    if (parts.length > 0) parts.push("");
                    parts.push(`[Exit code: ${exitCode}]`);
                }
                const outputText = parts.length > 0 ? parts.join("\n") : "(no output)";

                if (exitCode !== null && exitCode !== 0) {
                    throw new Error(outputText);
                }

                return { content: [{ type: "text", text: outputText }], details: { exitCode, truncated } };
            } finally {
                if (timeoutHandle) clearTimeout(timeoutHandle);
                signal?.removeEventListener("abort", onAbort);
            }
        }
    };
}
export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
    return wrapToolDefintion(createBashToolDefinition(cwd, options));
}