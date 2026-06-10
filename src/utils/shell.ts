import { ChildProcess, SpawnOptions, spawnSync, spawn } from "child_process";
import { existsSync } from "fs";
export type ShellType = "bash" | "powershell" | "cmd" | "sh"
export interface ShellConfig {
    type: ShellType;
    path: string;
    args: string[];
}

export function GetShellConfig(): ShellConfig {
    if (process.platform == "win32") {
        let path = `${process.env.ProgramFiles}\\Powershell\\7\\pwsh.exe`;
        if (existsSync(path)) {
            return { type: "powershell", path: path, args: ["-NoProfile", "-Command", "$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"] }
        }
        path = `${process.env.SystemRoot}\\System32\\cmd.exe`;
        return { type: "cmd", path: path, args: ["/c", "chcp 65001 >nul &&"] }
    } else {
        if (existsSync("/bin/bash")) {
            return { type: "bash", path: "/bin/bash", args: ["-c"] }
        }
        const result = spawnSync("which", ["bash"], { encoding: "utf-8", timeout: 5000 });
        if (result.status === 0 && result.stdout) {
            const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
            if (firstMatch) {
                return { type: "bash", path: firstMatch, args: ["-c"] }
            }
        }
        return { type: "sh", path: "/bin/sh", args: ["-c"] }
    }
}

const SHELL_CONFIGS: Record<ShellType, Omit<ShellConfig, "type">> = {
    bash: { path: "/bin/bash", args: ["-c"] },
    sh: { path: "/bin/sh", args: ["-c"] },
    powershell: { path: "pwsh.exe", args: ["-NoProfile", "-Command", "$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"] },
    cmd: { path: "cmd.exe", args: ["/c", "chcp 65001 >nul &&"] },
};

export function GetShellConfigByType(type: ShellType): ShellConfig {
    return { type, ...SHELL_CONFIGS[type] };
}


export function GetShellDescription(shellType: ShellType): string {
    switch (shellType) {
        case "bash":
        case "sh":
            return "Execute a bash command. The current shell is bash. Use bash/sh syntax for commands (pipes, redirects, &&, etc.)."
        case "cmd":
            return "Execute a command. The current shell is Windows cmd. Use cmd syntax for commands (&, |, etc.)."
        case "powershell":
            return "Execute a PowerShell command. The current shell is PowerShell. Use PowerShell syntax for commands (cmdlets, pipes, etc.)."
    }
}

export function SpawnShell(config: ShellConfig, command: string, args: string[], options: SpawnOptions): ChildProcess {
    const shArgs = [...config.args, command, ...args];
    const child = spawn(config.path, shArgs, options);
    return child;
}

export function KillProcessTree(pid: number): void {
    if (process.platform === "win32") {
        try {
            spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
                stdio: "ignore",
                detached: true,
                windowsHide: true,
            });
        } catch { }
    } else {
        try {
            process.kill(-pid, "SIGKILL");
        } catch {
            try {
                process.kill(pid, "SIGKILL");
            } catch { }
        }
    }
}

export function waitForChildProcess(child: ChildProcess): Promise<number | null> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let exited = false;
        let exitCode: number | null;
        let stdoutEnded = false, stderrEnded = false;
        let postExitTimer: NodeJS.Timeout | undefined;
        const cleanup = () => {
            if (postExitTimer) {
                clearTimeout(postExitTimer);
                postExitTimer = undefined;
            }
            child.stdout?.removeListener("end", onStdoutEnd);
            child.stderr?.removeListener("end", onStderrEnd);
            child.removeListener("error", onError);
            child.removeListener("exit", onExit);
            child.removeListener("close", onClose);
        };

        const finalize = (code: number | null) => {
            if (settled) return;
            settled = true;
            cleanup();
            child.stdout?.destroy();
            child.stderr?.destroy();
            resolve(code);
        }
        const maybeFinalizeAfterExit = () => {
            if (!exited || settled) return;
            if (stdoutEnded && stderrEnded) {
                finalize(exitCode);
            }
        };
        const onStdoutEnd = () => {
            stdoutEnded = true;
            maybeFinalizeAfterExit();
        }
        const onStderrEnd = () => {
            stderrEnded = true;
            maybeFinalizeAfterExit();
        }
        const onError = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        }
        const onExit = (code: number | null) => {
            exited = true;
            exitCode = code;
            maybeFinalizeAfterExit();
            if (!settled) {
                postExitTimer = setTimeout(() => finalize(code), 100);
            }
        }
        const onClose = (code: number | null) => {
            finalize(code);
        }
        child.stdout?.once("end", onStdoutEnd);
        child.stderr?.once("end", onStderrEnd);
        child.once("error", onError);
        child.once("exit", onExit);
        child.once("close", onClose);
    });
}