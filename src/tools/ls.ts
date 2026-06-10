import { readdir as fsReaddir, stat as fsStat, access, constants } from "node:fs/promises";
import { type Static, Type } from "typebox";
import nodePath from "path";
import { AgentTool, ToolDefinition } from "../core/extensions/types";
import { resolveToCwd } from "./path-utils";
import { wrapToolDefintion } from "./tool-definition-wrappers";

const lsSchema = Type.Object({
    path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
})

export type LsToolInput = Static<typeof lsSchema>;

const DEFAULT_LIMIT = 500;

export interface LsToolDetails {
    truncation?: string;
    entryLimiReached?: number;
}

export interface LsOperations {
    exists: (absolutePath: string) => Promise<boolean> | boolean;

    stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean };

    readdir: (absolutePath: string) => Promise<string[]> | string[];
}

const defaultLsOperations: LsOperations = {
    exists: pathExists,
    stat: fsStat,
    readdir: fsReaddir,
};

export async function pathExists(filepath: string): Promise<boolean> {
    try {
        await access(filepath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export interface LsToolOptions {
    operations?: LsOperations;
}

export function createLsToolDefinition(
    cwd: string,
    options?: LsToolOptions,
): ToolDefinition<typeof lsSchema, LsToolDetails | undefined> {
    const ops = options?.operations ?? defaultLsOperations;
    return {
        name: "ls",
        label: "ls",
        description: "",
        parameteres: lsSchema,
        async execute(
            _toolCallId,
            { path, limit }: { path?: string; limit?: number },
            signal?: AbortSignal,
        ) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(new Error("Operation aborted"));
                    return;
                }

                const onAbort = () => reject(new Error("Operation aborted"));
                signal?.addEventListener("abort", onAbort, { once: true });
                (async () => {
                    try {
                        const dirPath = resolveToCwd(path || ".", cwd);
                        const effectiveLimit = limit ?? DEFAULT_LIMIT;
                        if (!(await ops.exists(dirPath))) {
                            reject(new Error(`Path not found: ${dirPath}`));
                            return;
                        }

                        const stat = await ops.stat(dirPath);
                        if (!stat.isDirectory()) {
                            reject(new Error(`Not a directory: ${dirPath}`));
                            return;
                        }
                        let entries: string[];
                        try {
                            entries = await ops.readdir(dirPath);
                        } catch (e: any) {
                            reject(new Error(`Cannot read directory: ${e.message}`));
                            return;
                        }
                        entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

                        const results: string[] = [];
                        let entryLimitReached = false;
                        for (const entry of entries) {
                            if (results.length >= effectiveLimit) {
                                entryLimitReached = true;
                                break;
                            }
                            const fullPath = nodePath.join(dirPath, entry);
                            let suffix = "";
                            try {
                                const entryStat = await ops.stat(fullPath);
                                if (entryStat.isDirectory()) suffix = "/";
                            } catch {
                                continue;
                            }
                            results.push(entry + suffix);
                        }
                        signal?.removeEventListener("abort", onAbort);
                        if (results.length == 0) {
                            resolve({ content: [{ type: "text", text: "(empty directory)" }], details: undefined })
                            return;
                        }

                        const rawOutput = results.join("\n");
                        resolve({ content: [{ type: "text", text: rawOutput }], details: undefined });
                    } catch (e: any) {
                        signal?.removeEventListener("abort", onAbort);
                        reject(e);
                    }
                })();
            });
        }
    }
};

export function createLsTool(cwd: string, options?: LsToolOptions): AgentTool<typeof lsSchema> {
    return wrapToolDefintion(createLsToolDefinition(cwd, options));
};