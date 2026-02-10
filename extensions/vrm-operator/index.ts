import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { VrmApiClient } from "./src/api-client.js";
import { MinerClient } from "./src/miner-client.js";
import { createWorkOrderTools } from "./src/tools/work-orders.js";
import { createVendorTools } from "./src/tools/vendors.js";
import { createSchedulingTools } from "./src/tools/scheduling.js";
import { createDataQueryTools } from "./src/tools/data-query.js";
import { createMinerTools } from "./src/tools/miner.js";

interface VrmOperatorConfig {
  adminApiUrl: string;
  adminApiKey: string;
  jarvisUrl?: string;
  jarvisApiKey?: string;
  mcpServerUrl?: string;
  mcpServerApiKey?: string;
  tenants?: Record<string, string[] | "*">;
}

const VRM_TOOLS = new Set([
  "work_order_list", "work_order_create", "work_order_update",
  "vendor_list", "vendor_availability",
  "schedule_vendor", "reschedule_vendor",
  "ask_data_analyst",
  "customer_get", "customer_list",
  "property_list", "property_get",
  "reservation_list",
  "contact_list", "contact_get",
  "metrics_latest", "metrics_history",
]);

// --- Tenant isolation ---

type TenantPolicy =
  | { mode: "single"; cid: string }
  | { mode: "multi"; allowed: Set<string> }
  | { mode: "any" };

function buildTenantPolicies(
  tenants: Record<string, string[] | "*"> | undefined,
): Map<string, TenantPolicy> {
  const policies = new Map<string, TenantPolicy>();
  if (!tenants) return policies;
  for (const [agentId, spec] of Object.entries(tenants)) {
    if (spec === "*") {
      policies.set(agentId, { mode: "any" });
    } else if (spec.length === 1) {
      policies.set(agentId, { mode: "single", cid: spec[0] });
    } else {
      policies.set(agentId, { mode: "multi", allowed: new Set(spec) });
    }
  }
  return policies;
}

export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as VrmOperatorConfig | undefined;
  if (!config?.adminApiUrl || !config?.adminApiKey) {
    throw new Error("vrm-operator plugin requires adminApiUrl and adminApiKey in config");
  }

  const client = new VrmApiClient({
    baseUrl: config.adminApiUrl,
    apiKey: config.adminApiKey,
  });

  const tenantPolicies = buildTenantPolicies(config.tenants);

  // Validate tenant config references real agents
  if (config.tenants) {
    const knownAgents = new Set(
      (api.config as { agents?: { list?: { id: string }[] } }).agents?.list?.map(
        (a) => a.id,
      ) ?? [],
    );
    for (const id of Object.keys(config.tenants)) {
      if (!knownAgents.has(id)) {
        console.warn(`[vrm-tenant] policy references unknown agent '${id}'`);
      }
    }
  }

  const tools = [
    ...createWorkOrderTools(client),
    ...createVendorTools(client),
    ...createSchedulingTools(client),
  ];

  // Jarvis data query (optional — only if configured)
  if (config.jarvisUrl && config.jarvisApiKey) {
    tools.push(...createDataQueryTools({ url: config.jarvisUrl, apiKey: config.jarvisApiKey }));
  }

  // Miner integration via MCP server (optional — only if configured)
  if (config.mcpServerUrl && config.mcpServerApiKey) {
    const minerClient = new MinerClient({
      baseUrl: config.mcpServerUrl,
      apiKey: config.mcpServerApiKey,
    });
    tools.push(...createMinerTools(minerClient));
  }

  for (const tool of tools) {
    api.registerTool(tool, { optional: false });
  }

  // --- Health check ---

  api.registerHttpRoute({
    path: "/health",
    handler: async (_req, res) => {
      try {
        const check = await fetch(`${config.adminApiUrl}/health`);
        const ok = check.ok;
        res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: ok ? "ok" : "degraded", adminApi: ok }));
      } catch {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unhealthy", adminApi: false }));
      }
    },
  });

  // --- Hooks ---

  // Audit log all VRM tool calls with CID source tracking
  api.on("after_tool_call", (event, ctx) => {
    if (!VRM_TOOLS.has(event.toolName)) return;
    const status = event.error ? `ERROR: ${event.error}` : "ok";
    const duration = event.durationMs ? `${event.durationMs}ms` : "?";
    const policy = ctx.agentId ? tenantPolicies.get(ctx.agentId) : undefined;
    const cidSource = policy?.mode === "single" ? "injected" : "llm";
    const cid = (event.params as Record<string, unknown>).cid ?? "?";
    console.log(
      `[vrm-hook] tool=${event.toolName} agent=${ctx.agentId ?? "?"} ` +
      `cid=${cid} cid_source=${cidSource} status=${status} duration=${duration}`,
    );
  });

  // CID enforcement — auto-inject for single-CID agents, validate for multi/wildcard.
  // Wrapped in try/catch because the framework fails open on hook exceptions
  // (pi-tools.before-tool-call.ts:59-64 catches and allows through with original params).
  api.on("before_tool_call", (event, ctx) => {
    try {
      if (!VRM_TOOLS.has(event.toolName)) return;

      const params = event.params as Record<string, unknown>;
      const policy = ctx.agentId ? tenantPolicies.get(ctx.agentId) : undefined;

      if (!policy) {
        // No policy configured — backward compat: require CID, don't restrict value
        if (!params.cid) {
          return { block: true, blockReason: "Missing required 'cid' parameter" };
        }
        return;
      }

      // Single-CID: auto-inject (LLM choice ignored)
      if (policy.mode === "single") {
        return { params: { cid: policy.cid } };
      }

      // Multi or any: require CID from LLM
      if (!params.cid) {
        return { block: true, blockReason: "Missing required 'cid' parameter" };
      }

      // Multi: validate against allowlist
      if (policy.mode === "multi" && !policy.allowed.has(params.cid as string)) {
        console.error(
          `[vrm-tenant] BLOCKED: agent=${ctx.agentId} cid=${params.cid} ` +
          `allowed=[${[...policy.allowed]}] tool=${event.toolName}`,
        );
        return { block: true, blockReason: `Not authorized for client '${params.cid}'` };
      }
    } catch (err) {
      console.error(`[vrm-tenant] enforcement error: ${err}`);
      return { block: true, blockReason: "Internal tenant enforcement error" };
    }
  }, { priority: 10 });

  // Inject live context before agent runs
  api.on("before_agent_start", () => {
    const now = new Date();
    const context = [
      `Current time: ${now.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" })} ET`,
      `Today: ${now.toISOString().split("T")[0]}`,
    ].join("\n");
    return { prependContext: `<live-context>\n${context}\n</live-context>` };
  });

  // Format outgoing messages — strip internal markers
  api.on("message_sending", (event) => {
    let content = event.content;
    // Remove any leaked XML tags from tool responses
    content = content.replace(/<\/?(?:live-context|tool-log|internal)[^>]*>/g, "");
    if (content !== event.content) {
      return { content };
    }
  });
}
