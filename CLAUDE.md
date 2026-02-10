# VRM Operator (OpenClaw Agent)

AI agent for vendor scheduling (cleaners, pool, HVAC, laundry, maintenance) in vacation rental management. Built on OpenClaw framework.

**Location**: `clawed/` (fork of `openclaw/openclaw`). Plugin: `clawed/extensions/vrm-operator/`.

## Tools (31 total: 8 VRM + 11 Miner + 12 Atlassian)

| Tool | Purpose | Backend |
|------|---------|---------|
| `work_order_list/create/update` | Work order CRUD | Admin API (`VRM_ADMIN_API_URL`) |
| `vendor_list`, `vendor_availability` | Vendor lookup | Admin API |
| `schedule_vendor`, `reschedule_vendor` | Vendor scheduling | Admin API |
| `ask_data_analyst` | Agent handoff for BQ data questions | Jarvis agent (SSE streaming) |
| `customer_get`, `customer_list` | Customer config/status | Miner REST (`/api/mcp/*`) |
| `property_list`, `property_get` | Hospitality listings | Miner REST |
| `reservation_list` | Search reservations | Miner REST (queries BigQuery) |
| `contact_list`, `contact_get` | Guest contacts | Miner REST (entity_store DB) |
| `experiment_configs`, `experiment_config` | A/B test configs | Miner REST (PostgreSQL) |
| `metrics_latest`, `metrics_history` | Performance metrics | Miner REST |
| `jira_search/get_issue/create/update/transition` | Jira issue management | mcp-atlassian sidecar |
| `confluence_search/get_page/create/update/comment` | Confluence pages | mcp-atlassian sidecar |

## Jarvis Integration

- **Dev URL**: `https://jarvis-dot-jarvis-ml-dev.uc.r.appspot.com` (named App Engine service, not default)
- **Streaming**: `POST /v1/customer/{cid}/stream` → SSE events (`progress`, `tool`, `done`, `error`)
- **Fallback**: Non-streaming `POST /v1/customer/{cid}` on 404
- **Handler**: `platform/jarvis-agent/handlers/streaming.py` (thread-safe Queue → async SSE generator)
- **Timeouts**: 600s (10min) streaming and non-streaming (`data-query.ts`)

## Local Development

```bash
cd clawed

# Start mock admin API (port 3001)
cd mock-api && npx tsx index.ts

# Start gateway (requires .env with GEMINI_API_KEY, JARVIS_URL, JARVIS_API_KEY, etc.)
set -a && source .env && set +a
OPENCLAW_GATEWAY_TOKEN=dev OPENCLAW_STATE_DIR=$PWD/.openclaw \
  node scripts/run-node.mjs gateway run --bind loopback --port 18789 --verbose

# WebChat UI: http://localhost:18789/chat?token=dev
# Build: pnpm build
```

## OpenClaw Config Patterns

- **Config location**: `.openclaw/openclaw.json` (set `OPENCLAW_STATE_DIR` to find it)
- **agents.defaults**: Only supports `model` (not `tools` — put `tools.allow/deny` on each agent in `agents.list[]`)
- **identity**: Only `name/theme/emoji/avatar` (system instructions go in `AGENTS.md` in workspace dir)
- **Gateway auth**: `token` or `password` modes only (no `"none"`)
- **Plugin hooks**: `before_tool_call` (can block or inject `{ params }` to override), `after_tool_call` (logging), `before_agent_start` (context injection via `{ prependContext }`), `message_sending` (content rewriting). Hook param injection works via spread: `{ ...originalParams, ...hookResult.params }` (`src/agents/pi-tools.before-tool-call.ts:55`). Framework fails open on hook exceptions (`pi-tools.before-tool-call.ts:59-64`) — wrap hooks in try/catch that blocks on error.
- **Plugin HTTP routes**: `api.registerHttpRoute({ path, handler })` — handler is `(req: IncomingMessage, res: ServerResponse) => void` (`src/plugins/types.ts:253`). Used for `/health` endpoint.
- **Tenant isolation**: `plugins.entries.vrm-operator.config.tenants` maps agent IDs to allowed CIDs. Single-CID agents get auto-injection (LLM can't override). Wildcard `"*"` for admin agents. Enforced in `before_tool_call` hook (`extensions/vrm-operator/index.ts`)
- **Tool streaming**: `onUpdate` callback (3rd param of `execute()`) for progressive results. **Known issue**: progress text is stripped at gateway layer (`server-chat.ts:335-343`) — channels only get typing indicators, not progress text. Upstream issue logged at `~/dev/openclaw/ISSUE-tool-update-progress-stripped.md`
- **Multi-agent routing**: `bindings[]` in config routes Slack channels to agents by `{ agentId, match: { channel, peer: { kind, id } } }`
- **Slack features**: `reactionNotifications` (not `reactionNotificationMode`), `allowBots` (not `allowBotMessages`), `blockStreaming`, `replyToMode`, `thread.historyScope`. Message queue: `messages.queue.{mode, debounceMs, cap, drop}`
- **OpenAI chat completions**: Disabled by default. Enable with `gateway.http.endpoints.chatCompletions.enabled: true` in config. Endpoint: `POST /v1/chat/completions` (Bearer token auth, supports `stream: true/false`)

## Auth Architecture

**Auth chain**: Request → Gateway (token) → Agent → `before_tool_call` hook (tenant check) → Tool → Backend API (bearer)

| Layer | Mechanism | Header | Scope |
|-------|-----------|--------|-------|
| Gateway | Shared token | Bearer / query param | All users share one token |
| Admin API | Bearer token | `Authorization: Bearer {key}` | Shared across agents |
| Jarvis | Bearer token | `Authorization: Bearer {key}` | Shared across agents |
| Miner (optional) | API key | `X-API-Key: {key}` (from `MINER_MCP_API_KEY`) | Shared across agents |
| Atlassian | Basic auth (user:token) | Via mcp-atlassian env vars | Admin VM (sourabh agent) only |
| Tenant isolation | `before_tool_call` hook | — | Per-agent CID policy |

**Design decisions**:
- **Gateway token is service-to-service**: Frontend backend holds the secret, handles its own user auth. WebChat/HTTP API not exposed directly to end users.
- **Shared API keys** for now — all agents use the same backend credentials. Per-tenant keys deferred to when real admin API replaces mock.
- **Manual secret rotation** — re-run `fetch-secrets.sh` (production) or `fetch-secrets-admin.sh` (admin) + restart. No automated rotation.
- **No per-user identity in OpenClaw** — frontend can pass `user` field in chat completions request for audit trails if needed later.

## MCP Bridge Plugin (Jira + Confluence)

Generic plugin at `extensions/mcp-bridge/` that bridges external MCP servers into native OpenClaw tools. Currently wraps `sooperset/mcp-atlassian` (community MCP server, API token auth, SSE transport). The official Atlassian MCP requires browser OAuth 2.1 and can't work headlessly.

- **Architecture**: Gateway → mcp-bridge plugin → `LazyMcpClient` (SSE) → mcp-atlassian Docker sidecar → Atlassian Cloud API
- **Lazy connect**: First tool call triggers MCP connection; concurrent calls coalesce. Auto-reconnect on failure.
- **Tool access**: Only `sourabh` agent (admin VM) has Jira/Confluence tools. Production agents (`vrm-ops`, `vrm-twiddy`, `vrm-analyst`) do not have access.
- **Config**: `plugins.entries.mcp-bridge.config.servers.atlassian.url` in `openclaw.json` (template: `${MCP_ATLASSIAN_URL}` on admin VM only)
- **Dockerfile gotcha**: Extensions with external npm dependencies (e.g., `@modelcontextprotocol/sdk`) must have their `package.json` copied before `pnpm install --frozen-lockfile` in the Dockerfile. Otherwise pnpm only sees root + ui workspace members and skips extension deps.
- **Atlassian credentials**: `sourabh@aidaptive.com` on `jarvisml.atlassian.net`. API token in GCP Secret Manager (`openclaw-jira-api-token`). Same token for both Jira and Confluence.

## Logging

- **Stdout**: `/tmp/openclaw-gateway.log` (startup, errors, custom tool `console.log` output, agent responses)
- **Structured JSON**: `/tmp/openclaw/openclaw-YYYY-MM-DD.log` (tool start/end, sessions, agent runs — no payloads). Filter by runId to trace a single request.
- **Session transcripts**: `.openclaw/agents/{agent-id}/sessions/{session-id}.jsonl` — full chat history with user messages, agent responses, tool calls and results. Format: JSONL with `type` field (`session`, `message`, `tool_use`, `tool_result`). Messages have `role` (`user`/`assistant`) and `content` array.
- **Tool payload logging**: Custom `console.log` in `data-query.ts` / `ask_data_analyst` (request URL, params, response summary)

## Key Files

| File | Purpose |
|------|---------|
| `.openclaw/openclaw.json` | Gateway + agent + plugin config |
| `.openclaw/workspace/ops/AGENTS.md` | System instructions for vrm-ops agent |
| `.openclaw/workspace/twiddy/AGENTS.md` | System instructions for vrm-twiddy agent |
| `.openclaw/workspace/data/AGENTS.md` | System instructions for vrm-data agent |
| `.openclaw/workspace/sourabh/AGENTS.md` | System instructions for sourabh admin agent |
| `extensions/vrm-operator/index.ts` | Plugin entry, registers 19 tools + tenant isolation hooks |
| `extensions/vrm-operator/openclaw.plugin.json` | Plugin config schema (includes `tenants`) |
| `extensions/vrm-operator/src/api-client.ts` | Typed HTTP client for admin API |
| `extensions/vrm-operator/src/miner-client.ts` | Typed HTTP client for Miner REST API |
| `extensions/vrm-operator/src/tools/data-query.ts` | `ask_data_analyst` tool (SSE + fallback) |
| `extensions/vrm-operator/src/tools/miner.ts` | 11 Miner tool definitions (TypeBox schemas) |
| `extensions/mcp-bridge/index.ts` | MCP Bridge plugin entry, registers 12 Atlassian tools |
| `extensions/mcp-bridge/src/mcp-client.ts` | LazyMcpClient: connect-on-first-call, auto-reconnect |
| `extensions/mcp-bridge/src/tools/atlassian.ts` | 6 Jira + 6 Confluence tool definitions |
| `mock-api/index.ts` | Express mock admin API (in-memory state) |
| `mock-api/seed.ts` | Mock data: 5 vendors, 5 work orders, availability slots |
| `config/openclaw.vrm.json5` | Production config template (`${VAR}` placeholders) |
| `config/openclaw.admin.json5` | Admin config template (sourabh VM) |
| `docker-compose.prod.yml` | Production Docker Compose (gateway + mock-api) |
| `docker-compose.admin.yml` | Admin Docker Compose (gateway + mcp-atlassian) |
| `deploy.sh` | Production Cloud Build + GCE deploy |
| `deploy-admin.sh` | Admin deploy script (reuses images, no rebuild) |
| `rollback.sh` | Rollback to previous Cloud Build SHA |
| `deploy/fetch-secrets.sh` | Fetch production secrets from GCP Secret Manager → `.env` |
| `deploy/fetch-secrets-admin.sh` | Fetch admin secrets (no Slack tokens) |
| `deploy/render-config.mjs` | Strip JSON5 comments + expand `${VAR}` from env |
| `deploy/generate-config.sh` | Production: Source `.env` + render template → `openclaw.json` |
| `deploy/generate-config-admin.sh` | Admin: Source `.env` + render template → `openclaw.json` |
| `deploy/openclaw.service` | Production systemd unit |
| `deploy/openclaw-admin.service` | Admin systemd unit |
| `deploy/vm-setup.md` | GCE VM provisioning runbook |

## Mock Admin API

Run: `cd clawed/mock-api && npx tsx index.ts` (port 3001). Auth: `Authorization: Bearer dev-mock-key`.

**Endpoints** (all require `cid` param):

| Method | Path | Body / Query | Description |
|--------|------|-------------|-------------|
| `GET` | `/work_orders` | `?cid=&status=&property_id=&service_type=` | List work orders |
| `POST` | `/work_orders` | `{cid, property_id, service_type, description, priority?, due_date?}` | Create work order |
| `PATCH` | `/work_orders/:id` | `{cid, status?, notes?, vendor_id?}` | Update work order |
| `GET` | `/vendors` | `?cid=&service_type=&location=` | List vendors (no availability) |
| `GET` | `/vendors/:id/availability` | `?cid=&date=` | Vendor time slots |
| `POST` | `/work_orders/:id/schedule` | `{cid, vendor_id, scheduled_time, notes?}` | Schedule vendor for work order |
| `POST` | `/work_orders/:id/reschedule` | `{cid, reason?}` | Reschedule to next available vendor |
| `GET` | `/health` | — | Health check (no auth) |

**Seed data** (cid: `twiddy`):

| Vendors | Service Types | Work Orders | Properties |
|---------|--------------|-------------|------------|
| v-001 Outer Banks Clean Co. (Corolla) | cleaning | wo-1001 turnover clean (pending) | prop-201 |
| v-002 Crystal Clear Pools (Duck) | pool | wo-1002 pool check (scheduled) | prop-305 |
| v-003 Coastal HVAC Pros (Corolla) | hvac | wo-1003 heating broken (in_progress) | prop-201 |
| v-004 Beach Breeze Laundry (KDH) | laundry | wo-1004 linen pickup (completed) | prop-412 |
| v-005 Sandy Shores Maintenance (Corolla) | maintenance | wo-1005 loose railing (pending) | prop-305 |

Availability slots are Feb 10-11 only. State is in-memory (resets on restart).

## Production Deployment (Two GCE VMs)

**Production VM** `openclaw-gateway` (`e2-medium`, `us-west2-a`):
- **Channels**: Slack only (socket mode, `requireMention: true`)
- **Agents**: `vrm-ops` (internal, default, Slack #operator), `vrm-twiddy` (per-CID, Slack #operator-twiddy), `vrm-analyst` (subagent-only)
- **Containers**: 2 (gateway + mock-api). No mcp-atlassian, no WhatsApp.
- **Config template**: `config/openclaw.vrm.json5`
- **Secrets**: GCP Secret Manager (`jarvis-ml-dev` project). 10 secrets: `openclaw-gateway-token`, `openclaw-google-api-key`, `openclaw-slack-bot-token`, `openclaw-slack-app-token`, `openclaw-vrm-admin-api-key`, `openclaw-jarvis-api-key`, `openclaw-jira-url`, `openclaw-jira-username`, `openclaw-jira-api-token`, `openclaw-confluence-url`. Fetched by `deploy/fetch-secrets.sh` → `/opt/openclaw/.env`
- **Deploy**: `./deploy.sh [project-id]` — Cloud Build → SSH pull → secrets → config → restart → health check

**Admin VM** `openclaw-sourabh` (`e2-medium`, `asia-south2-a` Delhi):
- **Channels**: WhatsApp only (Baileys/WhatsApp Web, QR pairing, `dmPolicy: "allowlist"`)
- **Agents**: `sourabh` (admin, unrestricted, WhatsApp DM), `vrm-analyst` (subagent-only), `vrm-jira` (subagent-only)
- **Containers**: 2 (gateway + mcp-atlassian). No mock-api, no Slack.
- **Config template**: `config/openclaw.admin.json5`
- **Secrets**: GCP Secret Manager. 6 secrets: `openclaw-gateway-token`, `openclaw-google-api-key`, `openclaw-vrm-admin-api-key`, `openclaw-jarvis-api-key`, `openclaw-jira-username`, `openclaw-jira-api-token`, `openclaw-confluence-username`, `openclaw-confluence-api-token`. Fetched by `deploy/fetch-secrets-admin.sh` → `/opt/openclaw/.env`. No Slack tokens needed.
- **Deploy**: `./deploy-admin.sh [project-id]` — Reuses images from production build, no Docker rebuild. Pulls, re-tags, restarts.

**Shared details**:
- **Model**: `google/gemini-3-flash-preview` (free tier). Template uses `${MODEL_PRIMARY}` and `${GOOGLE_API_KEY}` placeholders.
- **Config generation**: Template (`config/openclaw.vrm.json5` or `config/openclaw.admin.json5`) → `deploy/render-config.mjs` strips comments + expands env vars → final `openclaw.json`. Runs as systemd ExecStartPre on every boot — **all config changes must go in the template**
- **Health check**: `GET /health` on gateway (plugin HTTP route, checks admin API upstream). Returns `{"status":"ok"|"degraded"|"unhealthy","adminApi":bool}`. Mock API `/health` is unauthenticated (before auth middleware).
- **Docker Compose**: Production has 2 containers (gateway + mock-api), admin has 2 (gateway + mcp-atlassian). `env_file: .env`, health checks use `node -e "fetch(...)"` for gateway, TCP socket check for mcp-atlassian. Log rotation, log volume at `/mnt/openclaw-data/logs:/tmp/openclaw`, `depends_on` with `condition: service_healthy`
- **Env reload**: `docker compose restart` does NOT re-read `.env` — use `docker compose up -d --force-recreate` after updating secrets
- **Auto-restart**: Systemd service — `ExecStartPre` fetches secrets + generates config, `ExecStart` runs `docker compose up -d`
- **Rollback**: `./rollback.sh <short-sha> [project-id]` — pulls tagged images, re-tags as latest, restarts
- **VM setup**: `deploy/vm-setup.md` — Debian 12, persistent disk at `/mnt/openclaw-data`, Docker CE, firewall rule for TCP 18789, IAM `roles/secretmanager.secretAccessor`
- **VM gotchas**: Data disk fstab must use `UUID=...` with `nofail` (not `/dev/sdb`) — device path changes on machine type resize. Boot disk fills up from Docker images (~6.4 GB per image) — prune with `docker image prune -af`. SSH from local: use `--ssh-flag="-F /dev/null"` to bypass `~/.ssh/config` port placeholder
- **WhatsApp setup** (admin VM only): Enable `plugins.entries.whatsapp.enabled: true` in config template. QR pairing: `docker exec -it <container> node dist/index.js channels login --channel whatsapp`. Creds saved to `credentials/whatsapp/default/creds.json` on persistent disk. Bindings use `peer: { kind: "dm", id: "+E.164number" }`
- **Typing indicator**: TTL is 10min (`typingTtlMs` in `src/auto-reply/reply/typing.ts:26`). Controls only the typing indicator, not tool execution timeout
