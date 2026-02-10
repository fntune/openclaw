# Tool `onUpdate` progress text is stripped before reaching channels

## Summary

When a tool calls `onUpdate({ content: [{ type: "text", text: "Analyzing..." }] })` during execution, the progress text is emitted as a `tool_execution_update` event but **stripped at the gateway layer** before reaching most channels. The only user-visible effect is a typing indicator refresh. Progressive status text (e.g. "Running SQL query...", "Generating chart...") never reaches the end user on any channel by default.

This matters for long-running tools (20-60s+) where the user stares at a spinner with no feedback on what's happening.

## Current behavior

```
Tool calls onUpdate({ content: [{ text: "[Planning] Analyzing..." }] })
  → Framework emits: { stream: "tool", data: { phase: "update", partialResult: {...} } }
  → Gateway (server-chat.ts:336-341): STRIPS partialResult unless verbose="full"
  → Slack (agent-runner-execution.ts:344): only calls signalToolStart() → "is typing..."
  → WebChat (verbose=on, default): shows tool name + spinner, no text
  → WhatsApp/Telegram/etc: nothing or typing indicator
```

| Channel                       | Gets event?             | Gets progress text? | User sees           |
| ----------------------------- | ----------------------- | ------------------- | ------------------- |
| WebChat (verbose=on, default) | Yes                     | **No** — stripped   | Tool name + spinner |
| WebChat (verbose=full)        | Yes                     | Yes                 | Progressive text    |
| Slack                         | Event → typing only     | **No**              | "is typing..."      |
| WhatsApp                      | Channel-dependent       | **No**              | Nothing or typing   |
| Chat Completions API          | Only if TOOL_EVENTS cap | **No** — stripped   | Nothing             |

## Root cause

Two chokepoints:

### 1. Gateway strips `partialResult` by default

`src/gateway/server-chat.ts:335-343`:

```typescript
const toolPayload =
  isToolEvent && toolVerbose !== "full"
    ? (() => {
        const data = evt.data ? { ...evt.data } : {};
        delete data.result;
        delete data.partialResult; // ← progress text deleted here
        return { ...evt, sessionKey, data };
      })()
    : agentPayload;
```

Default verbose level is `"on"`, which sends event metadata (phase, name, toolCallId) but strips all content. Only `"full"` preserves it, but `"full"` also exposes raw tool results — too noisy for most users.

### 2. Channel handlers ignore progress text

`src/auto-reply/reply/agent-runner-execution.ts:339-346`:

```typescript
onAgentEvent: async (evt) => {
  if (evt.stream === "tool") {
    const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
    if (phase === "start" || phase === "update") {
      await params.typingSignals.signalToolStart(); // ← only refreshes typing
      // partialResult text is available in evt.data but ignored
    }
  }
};
```

`signalToolStart()` in `typing-mode.ts:116-128` only starts/refreshes the typing indicator loop. It has no mechanism to forward progress text to the channel.

## Impact

Any plugin tool that uses `onUpdate` for progressive feedback gets its content silently dropped. The `onUpdate` API exists and works at the framework level, but the downstream pipeline neuters it.

Real-world example: A BigQuery agent tool takes 30-60s and streams progress ("Planning query...", "Executing SQL...", "Generating chart...") via `onUpdate`. User sees "is typing..." for the entire duration.

## Proposed fix

### Option A: New verbose level `"progress"` (minimal change)

Add a verbose level between `"on"` and `"full"` that preserves `partialResult` on `phase: "update"` events but still strips `result` on `phase: "result"`. This lets clients see progress without exposing full tool output.

```typescript
// server-chat.ts
if (isToolEvent && toolVerbose !== "full") {
  const data = evt.data ? { ...evt.data } : {};
  if (toolVerbose === "on" || data.phase !== "update") {
    delete data.partialResult;
  }
  delete data.result; // always strip final result unless "full"
  toolPayload = { ...evt, sessionKey, data };
}
```

Make `"progress"` the default, or make it opt-in per tool via `registerTool` options.

### Option B: Channel-agnostic progress signal (larger change)

Add `signalToolProgress(text: string)` to `TypingSignaler`:

```typescript
// typing-mode.ts
signalToolProgress: async (text: string) => {
  if (disabled) return;
  await typing.setProgressText(text); // new method on TypingController
};
```

Each channel implements `setProgressText` in its own way:

- **Slack**: `assistant.threads.setStatus({ status: text })` — shows "Analyzing your question..." instead of "is typing..."
- **WebChat**: Updates tool stream card with progress text (already works if partialResult not stripped)
- **WhatsApp/Telegram**: Send or edit a progress message, or use typing status

Wire it in `agent-runner-execution.ts`:

```typescript
if (phase === "update") {
  const text = extractProgressText(evt.data.partialResult);
  if (text) {
    await params.typingSignals.signalToolProgress(text);
  } else {
    await params.typingSignals.signalToolStart();
  }
}
```

### Option C: Per-tool opt-in (pragmatic)

Let `registerTool` accept a `streaming: true` flag that tells the gateway to preserve `partialResult` for that tool's events only.

```typescript
api.registerTool(tool, { optional: true, streaming: true });
```

Gateway checks this flag before stripping. Avoids changing defaults for all tools.

## Affected files

| File                                                     | Role                                                      |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `src/gateway/server-chat.ts:335-343`                     | Gateway event filter — strips partialResult               |
| `src/auto-reply/reply/agent-runner-execution.ts:339-346` | Agent runner — ignores progress text                      |
| `src/auto-reply/reply/typing-mode.ts:116-128`            | Typing signaler — no progress text method                 |
| `src/auto-reply/reply/typing.ts`                         | Typing controller — no progress text support              |
| `src/slack/monitor/message-handler/dispatch.ts:58-66`    | Slack typing callbacks — hardcoded "is typing..."         |
| `src/slack/monitor/context.ts:261-294`                   | Slack status API — supports arbitrary status text already |
| `ui/src/ui/app-tool-stream.ts:207-281`                   | WebChat — already renders partialResult if present        |

## Workaround

Instruct the LLM (via system prompt) to emit a text message before calling long-running tools:
"Before calling `query_data`, always send a brief message like 'Let me ask the data analyst...'"

This works across all channels because it goes through the normal text reply pipeline. But it's a prompt hack, not a framework-level solution, and doesn't provide progressive updates during execution.
