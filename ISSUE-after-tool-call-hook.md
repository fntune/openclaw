# Bug: `after_tool_call` hook is never invoked

## Summary

The `after_tool_call` plugin hook is fully defined in the type system, has a dispatch function in the hook runner, and is exposed on the `HookRunner` interface — but is never called from the tool execution path. Plugins that register `after_tool_call` handlers via `api.on("after_tool_call", ...)` will never see them fire.

`before_tool_call` was wired up in PR #6570 but `after_tool_call` was left behind.

## Symptoms

- Plugin `after_tool_call` handlers registered via `api.on()` never execute
- `hookRunner.hasHooks("after_tool_call")` returns `true` (hooks ARE registered)
- `hookRunner.runAfterToolCall()` exists and works if called manually
- No errors, no warnings — silent failure

## Root Cause

`wrapToolWithBeforeToolCallHook()` in `src/agents/pi-tools.before-tool-call.ts` wraps every tool's `execute()` to call `before_tool_call` before execution, but returns the result directly without ever firing `after_tool_call`:

```typescript
// src/agents/pi-tools.before-tool-call.ts:78-88
execute: async (toolCallId, params, signal, onUpdate) => {
  const outcome = await runBeforeToolCallHook({ ... });
  if (outcome.blocked) {
    throw new Error(outcome.reason);
  }
  return await execute(toolCallId, outcome.params, signal, onUpdate);
  // ^^^ returns here — no after_tool_call invocation
},
```

The full chain that works for `before_tool_call`:

```
pi-tools.ts:439  →  wrapToolWithBeforeToolCallHook(tool, ctx)
  → pi-tools.before-tool-call.ts:79  →  runBeforeToolCallHook()
    → hook-runner-global.ts:42  →  getGlobalHookRunner()
      → hooks.ts:288  →  hookRunner.runBeforeToolCall()
        → Plugin handler fires  ✅
```

The chain that's broken for `after_tool_call`:

```
hooks.ts:308     →  runAfterToolCall() exists  ✅
hooks.ts:456     →  exported on HookRunner     ✅
types.ts:407     →  event type defined         ✅
types.ts:504     →  handler signature defined  ✅
pi-tools.*.ts    →  NEVER CALLED              ❌  ← gap is here
```

## Affected files

| File                                            | Role                         | Status                                     |
| ----------------------------------------------- | ---------------------------- | ------------------------------------------ |
| `src/plugins/types.ts:306,407-413,504-507`      | Type definitions             | OK — fully defined                         |
| `src/plugins/hooks.ts:308-313,456`              | Dispatch function + export   | OK — implemented                           |
| `src/plugins/hook-runner-global.ts`             | Global singleton             | OK — exposes runner                        |
| `src/agents/pi-tools.before-tool-call.ts:67-91` | Tool wrapper                 | **BUG** — only calls `before`, not `after` |
| `src/agents/pi-tools.ts:439-444`                | Applies wrapper to all tools | OK — calls wrapper                         |

## Fix

Add `after_tool_call` invocation in `wrapToolWithBeforeToolCallHook()` after tool execution completes. The hook should:

1. **Fire in `finally`** — runs on both success and error
2. **Be fire-and-forget** — `.catch()` to avoid blocking tool result delivery
3. **Include timing** — `durationMs` from before/after `execute()`
4. **Not fire when blocked** — only if `before_tool_call` allowed execution
5. **Guard with `hasHooks`** — skip if no handlers registered

### Proposed change

```typescript
// src/agents/pi-tools.before-tool-call.ts
import type { AgentToolResult } from "@mariozechner/pi-agent-core";

export function wrapToolWithBeforeToolCallHook(
  tool: AnyAgentTool,
  ctx?: HookContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) return tool;
  const toolName = tool.name || "tool";
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const outcome = await runBeforeToolCallHook({
        toolName,
        params,
        toolCallId,
        ctx,
      });
      if (outcome.blocked) {
        throw new Error(outcome.reason);
      }
      const normalizedName = normalizeToolName(toolName);
      const startMs = Date.now();
      let result: AgentToolResult<unknown> | undefined;
      let error: string | undefined;
      try {
        result = await execute(toolCallId, outcome.params, signal, onUpdate);
        return result;
      } catch (err) {
        error = String(err);
        throw err;
      } finally {
        const hookRunner = getGlobalHookRunner();
        if (hookRunner?.hasHooks("after_tool_call")) {
          const normalizedParams = isPlainObject(outcome.params)
            ? (outcome.params as Record<string, unknown>)
            : {};
          hookRunner
            .runAfterToolCall(
              {
                toolName: normalizedName,
                params: normalizedParams,
                result,
                error,
                durationMs: Date.now() - startMs,
              },
              {
                toolName: normalizedName,
                agentId: ctx?.agentId,
                sessionKey: ctx?.sessionKey,
              },
            )
            .catch((err) => {
              log.warn(`after_tool_call hook failed: tool=${normalizedName} error=${String(err)}`);
            });
        }
      }
    },
  };
}
```

### Test cases to add

Add to `src/agents/pi-tools.before-tool-call.test.ts`:

```typescript
describe("after_tool_call hook integration", () => {
  let hookRunner: {
    hasHooks: ReturnType<typeof vi.fn>;
    runBeforeToolCall: ReturnType<typeof vi.fn>;
    runAfterToolCall: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    hookRunner = {
      hasHooks: vi.fn(),
      runBeforeToolCall: vi.fn(),
      runAfterToolCall: vi.fn().mockResolvedValue(undefined),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as any);
  });

  it("fires after_tool_call on successful execution", async () => {
    hookRunner.hasHooks.mockImplementation(
      (name: string) => name === "before_tool_call" || name === "after_tool_call",
    );
    hookRunner.runBeforeToolCall.mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({ content: [], details: {} });
    const tool = wrapToolWithBeforeToolCallHook({ name: "vendor_list", execute } as any, {
      agentId: "vrm-ops",
      sessionKey: "s1",
    });

    await tool.execute("call-1", { cid: "twiddy" }, undefined, undefined);

    expect(hookRunner.runAfterToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "vendor_list",
        params: { cid: "twiddy" },
        error: undefined,
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({
        toolName: "vendor_list",
        agentId: "vrm-ops",
        sessionKey: "s1",
      }),
    );
  });

  it("fires after_tool_call with error on failed execution", async () => {
    hookRunner.hasHooks.mockReturnValue(true);
    hookRunner.runBeforeToolCall.mockResolvedValue(undefined);
    const execute = vi.fn().mockRejectedValue(new Error("timeout"));
    const tool = wrapToolWithBeforeToolCallHook({ name: "query_data", execute } as any, {
      agentId: "vrm-ops",
    });

    await expect(tool.execute("call-2", {}, undefined, undefined)).rejects.toThrow("timeout");

    expect(hookRunner.runAfterToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "query_data",
        error: "Error: timeout",
        result: undefined,
      }),
      expect.objectContaining({ agentId: "vrm-ops" }),
    );
  });

  it("does not fire after_tool_call when before_tool_call blocks", async () => {
    hookRunner.hasHooks.mockReturnValue(true);
    hookRunner.runBeforeToolCall.mockResolvedValue({
      block: true,
      blockReason: "denied",
    });
    const execute = vi.fn();
    const tool = wrapToolWithBeforeToolCallHook({ name: "exec", execute } as any);

    await expect(tool.execute("call-3", {}, undefined, undefined)).rejects.toThrow("denied");

    expect(hookRunner.runAfterToolCall).not.toHaveBeenCalled();
  });

  it("does not block tool result when after_tool_call hook throws", async () => {
    hookRunner.hasHooks.mockReturnValue(true);
    hookRunner.runBeforeToolCall.mockResolvedValue(undefined);
    hookRunner.runAfterToolCall.mockRejectedValue(new Error("hook crash"));
    const execute = vi.fn().mockResolvedValue({ content: [], details: {} });
    const tool = wrapToolWithBeforeToolCallHook({ name: "read", execute } as any);

    const result = await tool.execute("call-4", {}, undefined, undefined);
    expect(result).toEqual({ content: [], details: {} });
  });

  it("skips after_tool_call when no hooks registered", async () => {
    hookRunner.hasHooks.mockImplementation(
      (name: string) => name === "before_tool_call", // after_tool_call → false
    );
    hookRunner.runBeforeToolCall.mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({ content: [], details: {} });
    const tool = wrapToolWithBeforeToolCallHook({ name: "read", execute } as any);

    await tool.execute("call-5", {}, undefined, undefined);

    expect(hookRunner.runAfterToolCall).not.toHaveBeenCalled();
  });
});
```

## Related upstream issues and PRs

### Issues

| #     | Title                                                              | Status |
| ----- | ------------------------------------------------------------------ | ------ |
| #5513 | Plugin hooks (agent_end, before_tool_call, etc.) are never invoked | Open   |
| #6535 | Plugin hooks exist in type system but some are never called        | Open   |
| #7297 | Feature: Wire up after_tool_call hook + exec auto-retry            | Open   |

### PRs — closed without merge

| #     | Title                                       | Reason                                               |
| ----- | ------------------------------------------- | ---------------------------------------------------- |
| #6520 | Wire before/after_tool_call hooks           | Superseded                                           |
| #6539 | Wire before/after_tool_call hooks           | Duplicate                                            |
| #8378 | Wire before/after_tool_call hooks           | Duplicate                                            |
| #9761 | Wire up 14 hooks + CI + session key changes | Closed by maintainer: **"Too big. Make small PRs."** |

### PRs — still open

| #      | Title                                       | Notes                                           |
| ------ | ------------------------------------------- | ----------------------------------------------- |
| #2340  | Agent tool call hooks fire during execution | Oldest, stale                                   |
| #6264  | Wire up after_tool_call only                | Focused, no maintainer review                   |
| #10678 | Wire after_tool_call into pipeline          | 7 tests, Greptile flagged edge case             |
| #11312 | Wire up 7 hooks                             | Most comprehensive open PR, type errors flagged |

### What got merged

**PR #6570** — wired up `before_tool_call` only. Merged quickly because it was small, focused, and clean. This is the pattern to follow.

## Why nothing else merged

1. **Maintainer wants small PRs** — #6570 (single hook) merged same day. #9761 (14 hooks) got _"Too big. Stop spamming me."_
2. **PR fragmentation** — 4 competing open PRs solving overlapping problems, reads as noise
3. **Low priority for core team** — no maintainer comments on any open `after_tool_call` PR or issue

## Recommendation

Submit a PR that mirrors exactly what #6570 did for `before_tool_call`:

- Single file change: `src/agents/pi-tools.before-tool-call.ts`
- Single import addition: `AgentToolResult` from `@mariozechner/pi-agent-core`
- Tests in existing test file: `src/agents/pi-tools.before-tool-call.test.ts`
- No scope creep — no other hooks, no CI changes, no session key changes
