# Bash 工具实现方案

## Context

mini-coding-agent 项目是一个 ReAct 范式的编码 Agent，当前仅实现了 `ls` 工具。`bash` 工具是 Agent 最核心的工具之一，允许 Agent 执行 shell 命令并与系统交互。`src/tools/bash.ts` 当前为空文件，需要完整实现。

## 设计概览

严格遵循 `ls.ts` 的模式：TypeBox Schema → Operations 接口(可测试性) → 默认实现 → ToolDefinition 工厂 → AgentTool 工厂。

### 关键设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 非零退出码处理 | **throw Error** | `AgentToolResult` 无 `isError` 字段，agent-loop 仅在 catch 中设 `isError: true`，与 ls 的 "Path not found" 抛错一致 |
| 进程启动方式 | **多 shell 支持** | LLM 生成命令，需知道当前 shell 类型才能生成正确语法。自动检测可用 shell，在 description 中告知 LLM |
| 超时机制 | 手动 setTimeout + SIGTERM/SIGKILL | 比传 `signal` 给 spawn 更可控，能生成更清晰的错误信息 |
| 输出截断 | 尾部保留 + `...[truncated]...` 标记 | 尾部通常包含诊断信息，对 LLM 更有用 |
| 安全策略 | 轻量危险模式警告(不阻断) | 编码 Agent 需要灵活命令执行，硬阻断会过于限制 |

---

## 文件变更清单

### 1. 创建 `src/tools/bash.ts` (主文件)

**Schema 定义:**
```typescript
const bashSchema = Type.Object({
    command: Type.String({ description: "The command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Maximum execution time in milliseconds (default: 120000)" })),
});
```

**Shell 类型与自动检测:**

定义 `ShellType` 枚举：
```typescript
export type ShellType = "bash" | "powershell" | "cmd";
```

自动检测逻辑（优先级从高到低）：
1. 如果 `options.shell` 被显式指定 → 使用指定值
2. 如果 `process.env.SHELL` 存在（Unix/Git Bash）→ `"bash"`
3. 如果 `process.env.ComSpec` 存在且包含 `cmd.exe`（Windows）→ `"cmd"`
4. 如果 `process.env.PSModulePath` 存在（Windows + PowerShell）→ `"powershell"`
5. 默认 → `process.platform === "win32" ? "cmd" : "bash"`

**description 动态生成** — 根据检测到的 shell 类型，在工具 description 中告知 LLM：
```typescript
// bash: "Execute a bash command. The current shell is bash (sh). Use bash syntax for commands."
// powershell: "Execute a PowerShell command. The current shell is PowerShell. Use PowerShell syntax for commands."
// cmd: "Execute a command. The current shell is Windows cmd. Use cmd syntax for commands."
```

这样 LLM 就能根据 shell 类型生成正确的命令语法（如 PowerShell 用 `Remove-Item` 而非 `rm`，bash 用 `&&` 而 cmd 用 `&` 等）。

**spawn 调用方式** — 根据 shell 类型选择不同的 spawn 参数：
```typescript
function getSpawnArgs(shellType: ShellType, command: string): [string, string[]] {
    switch (shellType) {
        case "bash": return [command, [], { shell: "/bin/sh" }]; // 或 process.env.SHELL
        case "powershell": return ["powershell", ["-Command", command], { shell: false }];
        case "cmd": return [command, [], { shell: true }]; // Node 自动用 cmd.exe /c
    }
}
```

**常量:**
- `DEFAULT_TIMEOUT_MS = 120_000` (2 分钟)
- `MAX_OUTPUT_LENGTH = 30_000` (约 7500 tokens)

**BashToolDetails 接口:**
```typescript
export interface BashToolDetails {
    exitCode: number | null;    // null = 进程被杀(超时/中断)
    truncated?: string;          // "stdout" | "stderr" | "stdout+stderr"
    timedOut?: boolean;
    signal?: string;
}
```

**BashOperations 接口(可测试性):**
```typescript
export interface BashOperations {
    spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcessLike;
    getShellType: () => ShellType;
}
```
- `SpawnOptions`: `{ cwd?, env?, shell?: string | boolean }`
- `ChildProcessLike`: 最小化接口，包含 `stdout.on`, `stderr.on`, `on`, `kill`, `exitCode`

**默认操作:**
- `getShellType()`: 执行上述自动检测逻辑
- `spawn()`: 根据 shellType 选择 spawn 参数
  - bash: `spawn(command, [], { shell: process.env.SHELL ?? "/bin/sh", stdio: ["pipe","pipe","pipe"] })`
  - powershell: `spawn("powershell", ["-Command", command], { stdio: ["pipe","pipe","pipe"] })`
  - cmd: `spawn(command, [], { shell: true, stdio: ["pipe","pipe","pipe"] })`
- 继承 `process.env`

**核心 execute 逻辑:**
1. 检查 pre-aborted signal → reject
2. 验证 command 非空 → reject
3. 设置 setTimeout 定时器(超时 → SIGTERM → 5s 后 SIGKILL)
4. 通过 `ops.spawn()` 启动进程
5. 监听 stdout/stderr 的 `data` 事件，累积到字符串缓冲区
6. 监听 AbortSignal，触发时 kill 进程
7. 监听 `close` 事件：
   - 清理定时器和 signal listener
   - 如果 aborted → reject("Operation aborted")
   - 截断超长输出(stderr 优先截断，保留 stdout 尾部)
   - 拼装输出：stdout + `[stderr]` + stderr + `[Process timed out]` + `[Exit code: N]`
   - exitCode !== 0 → **throw Error**(包含完整输出，agent-loop 会设 isError: true)
   - exitCode === 0 → resolve `{ content, details }`
8. 监听 `error` 事件 → reject

**BashToolOptions 接口:**
```typescript
export interface BashToolOptions {
    operations?: BashOperations;
    maxOutputLength?: number;
    defaultTimeout?: number;
    shell?: ShellType;  // 强制指定 shell 类型，覆盖自动检测
}
```

**工厂函数:**
```typescript
export function createBashToolDefinition(cwd: string, options?: BashToolOptions): ToolDefinition<typeof bashSchema, BashToolDetails>
export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema>
```

**description 动态生成逻辑:**
```typescript
function getShellDescription(shellType: ShellType): string {
    switch (shellType) {
        case "bash": return "Execute a bash command. The current shell is bash. Use bash/sh syntax for commands (pipes, redirects, &&, etc.).";
        case "powershell": return "Execute a PowerShell command. The current shell is PowerShell. Use PowerShell syntax for commands (cmdlets, pipes, etc.).";
        case "cmd": return "Execute a command. The current shell is Windows cmd. Use cmd syntax for commands (&, |, etc.).";
    }
}
```
在 `createBashToolDefinition` 中，`description` 字段使用 `getShellDescription(shellType)` 动态生成。

**注意: 保持代码库中的拼写一致性** — `parameteres`(非 parameters), `wrapToolDefintion`(非 wrapToolDefinition)

### 2. 修改 `src/tools/index.ts` (注册)

- 新增 import: `createBashTool`, `createBashToolDefinition`, `BashToolDetails`, `BashToolOptions` 等
- 新增 re-export 块
- `ToolsOptions` 接口添加 `bash?: BashToolOptions`
- `createToolDefinition` switch 添加 `case "bash"`
- `createTool` switch 添加 `case "bash"`

### 3. 创建 `src/test/bash.test.ts` (测试)

遵循 `ls.test.ts` 模式，使用 mock operations 注入。

**Mock 工厂 `mockOps()`:** 接受 `{ exitCode, stdout, stderr, delay, error }` 参数，返回模拟的 `BashOperations`，通过 setTimeout 异步触发 data/close 事件。

**测试用例(14 个):**

| # | 测试名 | 验证点 |
|---|--------|--------|
| 1 | successful command with stdout | stdout 正常返回，exitCode=0 |
| 2 | command with stderr only | 输出含 `[stderr]` 标记 |
| 3 | command with both stdout and stderr | 两者都有，格式正确 |
| 4 | non-zero exit code throws | reject 并包含 `[Exit code: N]` |
| 5 | empty command is rejected | 空串和纯空格都拒绝 |
| 6 | timeout kills process | 超时后进程被杀，输出含 `[Process timed out]` |
| 7 | abort signal cancels execution | AbortController.abort() 后 reject |
| 8 | pre-aborted signal | 已 abort 的 signal 立即 reject |
| 9 | output truncation | 超长输出被截断，含 `[truncated]` 标记 |
| 10 | spawn error | spawn 失败时 reject 含 "Failed to execute command" |
| 11 | command with no output | 返回 `"(no output)"` |
| 12 | custom timeout parameter | 传入 timeout 参数覆盖默认值 |
| 13 | shell type detection | mock getShellType 返回不同值，验证 description 不同 |
| 14 | forced shell type | options.shell 强制指定，覆盖自动检测 |

---

## 验证步骤

1. `npx vitest run src/test/bash.test.ts` — 新测试全部通过
2. `npx vitest run src/test/ls.test.ts` — 原有 ls 测试不受影响
3. `npx vitest run src/test/agent-loop.test.ts` — 原有 agent-loop 测试不受影响
4. TypeScript 类型检查: `npx tsc --noEmit` — 无类型错误
