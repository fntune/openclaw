import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

interface LazyMcpClientOptions {
  name: string;
  url: string;
  transport?: "sse" | "http";
  headers?: Record<string, string>;
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/**
 * Lazy MCP client — connects on first tool call, auto-reconnects on failure.
 * Supports SSE (legacy) and Streamable HTTP transports.
 */
export class LazyMcpClient {
  private readonly name: string;
  private readonly url: string;
  private readonly transportType: "sse" | "http";
  private readonly headers?: Record<string, string>;
  private client: Client | null = null;
  private transport: Transport | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(opts: LazyMcpClientOptions) {
    this.name = opts.name;
    this.url = opts.url;
    this.transportType = opts.transport ?? "sse";
    this.headers = opts.headers;
  }

  private createTransport(): Transport {
    const url = new URL(this.url);
    if (this.transportType === "http") {
      return new StreamableHTTPClientTransport(url, {
        requestInit: this.headers ? { headers: this.headers } : undefined,
      });
    }
    return new SSEClientTransport(url, {
      requestInit: this.headers ? { headers: this.headers } : undefined,
    });
  }

  private async connect(): Promise<Client> {
    const client = new Client({ name: `mcp-bridge-${this.name}`, version: "1.0.0" });
    const transport = this.createTransport();
    await client.connect(transport);
    this.client = client;
    this.transport = transport;
    console.log(`[mcp-bridge] connected to ${this.name} at ${this.url} (${this.transportType})`);
    return client;
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    // Coalesce concurrent connection attempts
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private reset(): void {
    try {
      this.transport?.close();
    } catch {
      // ignore close errors
    }
    this.client = null;
    this.transport = null;
    this.connecting = null;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    let client: Client;
    try {
      client = await this.ensureConnected();
    } catch (err) {
      this.reset();
      throw new Error(`[mcp-bridge] failed to connect to ${this.name}: ${err}`);
    }

    let result: McpToolResult;
    try {
      result = (await client.callTool({ name, arguments: args })) as McpToolResult;
    } catch (err) {
      // Connection may have dropped — reset so next call reconnects
      this.reset();
      throw new Error(`[mcp-bridge] tool ${name} failed on ${this.name}: ${err}`);
    }

    if (result.isError) {
      const text = result.content.map((c) => c.text ?? "").join("\n");
      throw new Error(`[mcp-bridge] ${name} returned error: ${text}`);
    }

    return result.content.map((c) => c.text ?? "").join("\n");
  }

  async close(): Promise<void> {
    this.reset();
  }
}
