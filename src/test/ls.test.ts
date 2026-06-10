import nodePath from "path";
import { describe, expect, test } from "vitest";
import { createLsToolDefinition } from "../tools/ls.ts";
import type { LsOperations } from "../tools/ls.ts";
import { TextContent } from "../core/extensions/types";

function mockOps(overrides: {
    exists?: (absolutePath: string) => Promise<boolean> | boolean;
    entries?: string[];
    dirs?: string[];
}): LsOperations {
    const { exists = () => true, entries = [], dirs = [] } = overrides;
    return {
        exists,
        readdir: () => Promise.resolve(entries),
        stat: (p) => {
            const name = nodePath.basename(p);
            return Promise.resolve({ isDirectory: () => dirs.includes(name) });
        },
    };
}

describe("ls", () => {
    describe("createLsToolDefinition", () => {
        test("normal", async () => {
            const ops = mockOps({
                entries: ["foo", "bar", "baz"],
                dirs: ["dir", "foo", "baz"],
            });
            const tool = createLsToolDefinition(".", { operations: ops });
            const res = await tool.execute("1", { path: "some/dir" }, undefined);
            expect((res.content[0] as TextContent).text).toBe("bar\nbaz/\nfoo/");
        });

        test("dir not exist", async () => {
            const ops = mockOps({ exists: () => false });
            const tool = createLsToolDefinition(".", { operations: ops });
            await expect(tool.execute("2", { path: "xyun" }, undefined))
                .rejects.toThrow("Path not found");
        });

        test("not a directory", async () => {
            const ops = mockOps({ dirs: [] });
            const tool = createLsToolDefinition(".", { operations: ops });
            await expect(tool.execute("2b", { path: "some/file" }, undefined))
                .rejects.toThrow("Not a directory");
        });

        test("empty dir", async () => {
            const ops = mockOps({ entries: [], dirs: ["dir"] });
            const tool = createLsToolDefinition(".", { operations: ops });
            const res = await tool.execute("3", { path: "empty/dir" }, undefined);
            expect((res.content[0] as TextContent).text).toBe("(empty directory)");
        });

        test("dir limit", async () => {
            const ops = mockOps({
                entries: ["a", "b", "c", "d", "e", "f"],
                dirs: ["dir"],
            });
            const tool = createLsToolDefinition(".", { operations: ops });
            const res = await tool.execute("4", { path: "some/dir", limit: 3 }, undefined);
            const entries = (res.content[0] as TextContent).text.split("\n");
            expect(entries).toHaveLength(3);
        });
    });
});
