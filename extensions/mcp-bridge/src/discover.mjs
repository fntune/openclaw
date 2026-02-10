#!/usr/bin/env node
// MCP tool discovery — connects to an MCP server, lists tools, outputs JSON to stdout.
// Usage: node discover.mjs <url> [timeout_ms] [transport] [headers_json]

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2];
const timeoutMs = parseInt(process.argv[3] || "10000", 10);
const transportType = process.argv[4] || "sse";
const headersJson = process.argv[5];

if (!url) {
  process.stderr.write("Usage: node discover.mjs <url> [timeout_ms] [transport] [headers_json]\n");
  process.exit(1);
}

const headers = headersJson ? JSON.parse(headersJson) : undefined;
const requestInit = headers ? { headers } : undefined;

const timer = setTimeout(() => {
  process.stderr.write(`Discovery timed out after ${timeoutMs}ms for ${url}\n`);
  process.exit(1);
}, timeoutMs);

try {
  const parsedUrl = new URL(url);
  const transport =
    transportType === "http"
      ? new StreamableHTTPClientTransport(parsedUrl, { requestInit })
      : new SSEClientTransport(parsedUrl, { requestInit });

  const client = new Client({ name: "mcp-bridge-discover", version: "1.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const out = (tools || []).map((t) => ({
    name: t.name,
    description: t.description || "",
    inputSchema: t.inputSchema,
  }));

  process.stdout.write(JSON.stringify(out));
  await transport.close();
} catch (err) {
  process.stderr.write(`Discovery failed for ${url}: ${err}\n`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

process.exit(0);
