import { describe, expect, test } from "vitest";
import { createBashToolDefinition } from "../tools/bash.ts";
import type { BashOperations } from "../tools/bash.ts";
import type { ShellConfig, ShellType } from "../utils/shell.ts";
import { GetShellDescription, GetShellConfig, GetShellConfigByType } from "../utils/shell.ts";
import { TextContent } from "../core/extensions/types";

// ─── Mock Operations ───────────────────────────────────────────────

interface MockChildProcess {
    pid: number | undefined;
    stdout: { on(event: string, listener: (...args: any[]) => void): void };
    stderr: { on(event: string, listener: (...args: any[]) => void): void };
    on(event: string, listener: (...args: any[]) => void): void;
    kill(signal?: string): boolean;
}

function mockOps(overrides: {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    delay?: number;
    spawnError?: Error;
    shellType?: ShellType;
}): BashOperations {
    const {
        exitCode = 0,
        stdout = "",
        stderr = "",
        delay = 0,
        spawnError,
        shellType = "bash",
    } = overrides;

    const config: ShellConfig = {
        type: shellType,
        path: shellType === "bash" ? "/bin/bash" : shellType === "powershell" ? "pwsh.exe" : "cmd.exe",
        args: ["-c"],
    };

    return {
        getShellConfig: () => config,
        spawn: (_cfg: ShellConfig, _command: string, _args: string[], _options: any): MockChildProcess => {
            const listeners: Record<string, ((...args: any[]) => void)[]> = {};

            const mockProcess: MockChildProcess = {
                pid: 12345,
                stdout: {
                    on(event: string, listener: (...args: any[]) => void) {
                        const key = `stdout:${event}`;
                        if (!listeners[key]) listeners[key] = [];
                        listeners[key].push(listener);
                    },
                    once(event: string, listener: (...args: any[]) => void) {
                        const key = `stdout:${event}`;
                        if (!listeners[key]) listeners[key] = [];
                        listeners[key].push((...a: any[]) => {
                            listener(...a);
                        });
                    },
                    removeListener() {},
                    destroy() {},
                },
                stderr: {
                    on(event: string, listener: (...args: any[]) => void) {
                        const key = `stderr:${event}`;
                        if (!listeners[key]) listeners[key] = [];
                        listeners[key].push(listener);
                    },
                    once(event: string, listener: (...args: any[]) => void) {
                        const key = `stderr:${event}`;
                        if (!listeners[key]) listeners[key] = [];
                        listeners[key].push((...a: any[]) => {
                            listener(...a);
                        });
                    },
                    removeListener() {},
                    destroy() {},
                },
                on(event: string, listener: (...args: any[]) => void) {
                    if (!listeners[event]) listeners[event] = [];
                    listeners[event].push(listener);
                },
                once(event: string, listener: (...args: any[]) => void) {
                    if (!listeners[event]) listeners[event] = [];
                    listeners[event].push(listener);
                },
                removeListener() {},
                kill(_signal?: string) {
                    return true;
                },
            };

            setTimeout(() => {
                if (spawnError) {
                    for (const l of listeners["error"] ?? []) l(spawnError);
                    return;
                }

                if (stdout) {
                    for (const l of listeners["stdout:data"] ?? []) l(Buffer.from(stdout));
                }
                if (stderr) {
                    for (const l of listeners["stderr:data"] ?? []) l(Buffer.from(stderr));
                }

                for (const l of listeners["close"] ?? []) l(exitCode);
            }, delay);

            return mockProcess;
        },
    };
}

// ─── Bash Tool Tests ───────────────────────────────────────────────

describe("bash", () => {
    describe("createBashToolDefinition", () => {
        test("successful command with stdout", async () => {
            const ops = mockOps({ exitCode: 0, stdout: "hello world" });
            const tool = createBashToolDefinition(".", { operations: ops });
            const res = await tool.execute("1", { command: "echo hello" }, undefined);
            expect((res.content[0] as TextContent).text).toBe("hello world");
            expect(res.details?.exitCode).toBe(0);
        });

        test("command with stderr only", async () => {
            const ops = mockOps({ exitCode: 0, stderr: "warning message" });
            const tool = createBashToolDefinition(".", { operations: ops });
            const res = await tool.execute("2", { command: "warn" }, undefined);
            const text = (res.content[0] as TextContent).text;
            expect(text).toContain("[stderr]");
            expect(text).toContain("warning message");
        });

        test("command with both stdout and stderr", async () => {
            const ops = mockOps({ exitCode: 0, stdout: "output", stderr: "error" });
            const tool = createBashToolDefinition(".", { operations: ops });
            const res = await tool.execute("3", { command: "both" }, undefined);
            const text = (res.content[0] as TextContent).text;
            expect(text).toContain("output");
            expect(text).toContain("[stderr]");
            expect(text).toContain("error");
            // stdout appears before stderr
            const stderrIndex = text.indexOf("[stderr]");
            const stdoutIndex = text.indexOf("output");
            expect(stdoutIndex).toBeLessThan(stderrIndex);
        });

        test("non-zero exit code throws with output", async () => {
            const ops = mockOps({ exitCode: 1, stdout: "partial", stderr: "command failed" });
            const tool = createBashToolDefinition(".", { operations: ops });
            try {
                await tool.execute("4", { command: "fail" }, undefined);
                expect.unreachable("Should have thrown");
            } catch (e: any) {
                expect(e.message).toContain("partial");
                expect(e.message).toContain("command failed");
                expect(e.message).toContain("[Exit code: 1]");
            }
        });

        test("exit code null (killed process) resolves with null exitCode", async () => {
            const ops = mockOps({ exitCode: null, stdout: "partial" });
            const tool = createBashToolDefinition(".", { operations: ops });
            const res = await tool.execute("4b", { command: "killed" }, undefined);
            expect(res.details?.exitCode).toBeNull();
            expect((res.content[0] as TextContent).text).toBe("partial");
        });

        test("empty command is rejected", async () => {
            const ops = mockOps({ exitCode: 0 });
            const tool = createBashToolDefinition(".", { operations: ops });
            await expect(tool.execute("5", { command: "" }, undefined))
                .rejects.toThrow("empty command");
            await expect(tool.execute("5b", { command: "   " }, undefined))
                .rejects.toThrow("empty command");
        });

        test("pre-aborted signal rejects immediately", async () => {
            const ops = mockOps({ exitCode: 0 });
            const tool = createBashToolDefinition(".", { operations: ops });
            const controller = new AbortController();
            controller.abort();
            await expect(tool.execute("8", { command: "echo" }, controller.signal))
                .rejects.toThrow("Operation aborted");
        });

        test("abort signal cancels execution", async () => {
            // Mock where KillProcessTree is intercepted: after abort, we manually emit close
            const listeners: Record<string, ((...args: any[]) => void)[]> = {};
            const ops: BashOperations = {
                getShellConfig: () => ({ type: "bash", path: "/bin/bash", args: ["-c"] }),
                spawn: () => ({
                    pid: 12345,
                    stdout: {
                        on(event: string, listener: (...args: any[]) => void) {
                            const key = `stdout:${event}`;
                            if (!listeners[key]) listeners[key] = [];
                            listeners[key].push(listener);
                        },
                        once(event: string, listener: (...args: any[]) => void) {
                            const key = `stdout:${event}`;
                            if (!listeners[key]) listeners[key] = [];
                            listeners[key].push(listener);
                        },
                        removeListener() {},
                        destroy() {},
                    },
                    stderr: {
                        on(event: string, listener: (...args: any[]) => void) {
                            const key = `stderr:${event}`;
                            if (!listeners[key]) listeners[key] = [];
                            listeners[key].push(listener);
                        },
                        once(event: string, listener: (...args: any[]) => void) {
                            const key = `stderr:${event}`;
                            if (!listeners[key]) listeners[key] = [];
                            listeners[key].push(listener);
                        },
                        removeListener() {},
                        destroy() {},
                    },
                    on(event: string, listener: (...args: any[]) => void) {
                        if (!listeners[event]) listeners[event] = [];
                        listeners[event].push(listener);
                    },
                    once(event: string, listener: (...args: any[]) => void) {
                        if (!listeners[event]) listeners[event] = [];
                        listeners[event].push(listener);
                    },
                    removeListener() {},
                    kill() { return true; },
                }),
            };
            const tool = createBashToolDefinition(".", { operations: ops, defaultTimeout: 60000 });
            const controller = new AbortController();
            const promise = tool.execute("7", { command: "long-running" }, controller.signal);
            // After abort, KillProcessTree is called but mock doesn't auto-close.
            // We simulate the OS closing the process after kill:
            setTimeout(() => {
                controller.abort();
                // After KillProcessTree, the OS would send a close event
                setTimeout(() => {
                    for (const l of listeners["close"] ?? []) l(null);
                }, 10);
            }, 10);
            await expect(promise).rejects.toThrow("Operation aborted");
        }, 10000);

        test("output truncation on stdout", async () => {
            const longOutput = "x".repeat(50_000);
            const ops = mockOps({ exitCode: 0, stdout: longOutput });
            const tool = createBashToolDefinition(".", {
                operations: ops,
                maxOutputLength: 1000,
            });
            const res = await tool.execute("9", { command: "big-output" }, undefined);
            const text = (res.content[0] as TextContent).text;
            expect(text.length).toBeLessThan(longOutput.length);
            expect(text).toContain("[truncated]");
            expect(res.details?.truncated).toBe("stdout");
        });

        test("output truncation on both stdout and stderr", async () => {
            const longStdout = "a".repeat(40_000);
            const longStderr = "b".repeat(40_000);
            const ops = mockOps({ exitCode: 0, stdout: longStdout, stderr: longStderr });
            const tool = createBashToolDefinition(".", {
                operations: ops,
                maxOutputLength: 1000,
            });
            const res = await tool.execute("9b", { command: "big-both" }, undefined);
            expect(res.details?.truncated).toBe("stdout+stderr");
        });

        test("spawn error", async () => {
            const ops = mockOps({ spawnError: new Error("ENOENT: command not found") });
            const tool = createBashToolDefinition(".", { operations: ops });
            await expect(tool.execute("10", { command: "nonexistent" }, undefined))
                .rejects.toThrow();
        });

        test("command with no output", async () => {
            const ops = mockOps({ exitCode: 0, stdout: "", stderr: "" });
            const tool = createBashToolDefinition(".", { operations: ops });
            const res = await tool.execute("11", { command: "true" }, undefined);
            expect((res.content[0] as TextContent).text).toBe("(no output)");
        });

        test("custom timeout parameter overrides default", async () => {
            const ops = mockOps({ exitCode: 0, stdout: "done" });
            const tool = createBashToolDefinition(".", {
                operations: ops,
                defaultTimeout: 5000,
            });
            const res = await tool.execute("12", { command: "fast", timeout: 10000 }, undefined);
            expect((res.content[0] as TextContent).text).toBe("done");
        });

        test("description reflects shell type", () => {
            const ops = mockOps({ shellType: "bash" });
            const tool = createBashToolDefinition(".", { operations: ops });
            expect(tool.description).toContain("bash");

            const opsPs = mockOps({ shellType: "powershell" });
            const toolPs = createBashToolDefinition(".", { operations: opsPs });
            expect(toolPs.description).toContain("PowerShell");
        });

        test("forced shell type via options", () => {
            const ops = mockOps({ shellType: "bash" });
            const tool = createBashToolDefinition(".", { operations: ops, shell: "cmd" });
            expect(tool.description).toContain("cmd");
        });
    });
});

// ─── Shell Utils Tests ─────────────────────────────────────────────

describe("shell utils", () => {
    describe("GetShellDescription", () => {
        test("bash", () => {
            expect(GetShellDescription("bash")).toContain("bash");
        });

        test("sh", () => {
            expect(GetShellDescription("sh")).toContain("bash");
        });

        test("powershell", () => {
            expect(GetShellDescription("powershell")).toContain("PowerShell");
        });

        test("cmd", () => {
            expect(GetShellDescription("cmd")).toContain("cmd");
        });
    });

    describe("GetShellConfigByType", () => {
        test("bash config", () => {
            const config = GetShellConfigByType("bash");
            expect(config.type).toBe("bash");
            expect(config.path).toContain("bash");
            expect(config.args).toContain("-c");
        });

        test("powershell config", () => {
            const config = GetShellConfigByType("powershell");
            expect(config.type).toBe("powershell");
            expect(config.path).toContain("pwsh");
            expect(config.args).toContain("-NoProfile");
        });

        test("cmd config", () => {
            const config = GetShellConfigByType("cmd");
            expect(config.type).toBe("cmd");
            expect(config.args[0]).toBe("/c");
        });

        test("sh config", () => {
            const config = GetShellConfigByType("sh");
            expect(config.type).toBe("sh");
            expect(config.path).toContain("sh");
        });
    });

    describe("GetShellConfig", () => {
        test("returns valid config on current platform", () => {
            const config = GetShellConfig();
            expect(config.type).toBeTruthy();
            expect(config.path).toBeTruthy();
            expect(config.args.length).toBeGreaterThan(0);
        });
    });
});
