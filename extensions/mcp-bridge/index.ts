import { execSync } from "node:child_process";
import path from "node:path";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { LazyMcpClient } from "./src/mcp-client.js";

interface McpServerConfig {
  url: string;
  enabled?: boolean;
  timeout?: number;
  prefix?: string;
  transport?: "sse" | "http";
  headers?: Record<string, string>;
}

interface McpBridgeConfig {
  servers?: Record<string, McpServerConfig>;
}

interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function discoverTools(
  scriptPath: string,
  extensionDir: string,
  url: string,
  timeoutMs: number,
  transport: string,
  headers?: Record<string, string>,
): DiscoveredTool[] {
  const headersArg = headers ? JSON.stringify(JSON.stringify(headers)) : '""';
  const stdout = execSync(
    `node ${JSON.stringify(scriptPath)} ${JSON.stringify(url)} ${timeoutMs} ${transport} ${headersArg}`,
    {
      cwd: extensionDir,
      encoding: "utf-8",
      timeout: timeoutMs + 5000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout);
}

export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as McpBridgeConfig | undefined;
  if (!config?.servers || Object.keys(config.servers).length === 0) {
    console.warn("[mcp-bridge] no servers configured — plugin idle");
    return;
  }

  const extensionDir = path.dirname(api.source);
  const discoverScript = path.join(extensionDir, "src", "discover.mjs");
  const allToolNames = new Set<string>();

  for (const [serverName, serverConfig] of Object.entries(config.servers)) {
    if (serverConfig.enabled === false) continue;

    const timeoutMs = serverConfig.timeout ?? 10_000;
    const transport = serverConfig.transport ?? "sse";
    let tools: DiscoveredTool[];
    try {
      tools = discoverTools(discoverScript, extensionDir, serverConfig.url, timeoutMs, transport, serverConfig.headers);
    } catch (err) {
      console.warn(`[mcp-bridge] discovery failed for ${serverName} (${serverConfig.url}): ${err}`);
      continue;
    }

    if (tools.length === 0) {
      console.warn(`[mcp-bridge] ${serverName} returned 0 tools`);
      continue;
    }

    const client = new LazyMcpClient({ name: serverName, url: serverConfig.url, transport, headers: serverConfig.headers });
    const prefix = serverConfig.prefix ?? "";

    for (const tool of tools) {
      const toolName = prefix + tool.name;
      if (allToolNames.has(toolName)) {
        console.warn(`[mcp-bridge] name collision: "${toolName}" from ${serverName} — skipping`);
        continue;
      }
      allToolNames.add(toolName);

      api.registerTool({
        name: toolName,
        description: tool.description,
        parameters: tool.inputSchema as any,
        async execute(_id: string, params: Record<string, unknown>) {
          const text = await client.callTool(tool.name, params);
          return { content: [{ type: "text" as const, text }] };
        },
      }, { optional: true });
    }

    console.log(`[mcp-bridge] discovered ${tools.length} tools from ${serverName} (url=${serverConfig.url})`);
  }

  if (allToolNames.size === 0) return;

  // Audit logging for all MCP-bridged tools
  api.on("after_tool_call", (event, ctx) => {
    if (!allToolNames.has(event.toolName)) return;
    const status = event.error ? `ERROR: ${event.error}` : "ok";
    const duration = event.durationMs ? `${event.durationMs}ms` : "?";
    console.log(
      `[mcp-bridge] tool=${event.toolName} agent=${ctx.agentId ?? "?"} ` +
      `status=${status} duration=${duration}`,
    );
  });
}
