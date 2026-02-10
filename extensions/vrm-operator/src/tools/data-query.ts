import { Type } from "@sinclair/typebox";

interface JarvisConfig {
  url: string;
  apiKey: string;
}

interface JarvisResponse {
  response: string;
  charts?: Array<{ ref: string; title: string; image_url: string }>;
  export?: { title: string; columns: string[]; data: unknown[][]; row_count: number; sql: string };
}

interface ToolUpdate {
  content: Array<{ type: string; text: string }>;
  details: unknown;
}

type OnUpdateCallback = (partialResult: ToolUpdate) => void;

function formatResponse(data: JarvisResponse): { content: Array<{ type: string; text: string }> } {
  const parts: string[] = [data.response];

  if (data.charts && data.charts.length > 0) {
    parts.push("\n**Charts:**");
    for (const chart of data.charts) {
      parts.push(`- ${chart.title}: ${chart.image_url}`);
    }
  }

  if (data.export) {
    parts.push(`\n**Data** (${data.export.row_count} rows):`);
    const cols = data.export.columns;
    const rows = data.export.data.slice(0, 10);
    parts.push(`| ${cols.join(" | ")} |`);
    parts.push(`| ${cols.map(() => "---").join(" | ")} |`);
    for (const row of rows) {
      const cells = Array.isArray(row) ? row : Object.values(row as Record<string, unknown>);
      parts.push(`| ${cells.join(" | ")} |`);
    }
    if (data.export.row_count > 10) {
      parts.push(`... and ${data.export.row_count - 10} more rows`);
    }
  }

  return { content: [{ type: "text", text: parts.join("\n") }] };
}

function parseSSEEvents(chunk: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const blocks = chunk.split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) {
        event = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      }
    }
    if (event && data) {
      events.push({ event, data });
    }
  }
  return events;
}

async function executeStreaming(
  config: JarvisConfig,
  cid: string,
  question: string,
  onUpdate?: OnUpdateCallback,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  const url = `${config.url}/v1/customer/${cid}/stream`;
  log("INFO", `request POST ${url} (streaming)`, { cid, question });
  const start = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    log("ERROR", `stream response ${res.status} (${Date.now() - start}ms)`, text);
    throw new Error(`Jarvis stream failed (${res.status}): ${text}`);
  }

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE blocks (separated by double newline)
      const lastDoubleNewline = buffer.lastIndexOf("\n\n");
      if (lastDoubleNewline === -1) continue;

      const complete = buffer.slice(0, lastDoubleNewline + 2);
      buffer = buffer.slice(lastDoubleNewline + 2);

      const events = parseSSEEvents(complete);
      for (const evt of events) {
        const parsed = JSON.parse(evt.data) as Record<string, unknown>;

        if (evt.event === "done") {
          const jarvis = parsed as unknown as JarvisResponse;
          log("INFO", `stream done (${Date.now() - start}ms)`, {
            responseLength: jarvis.response.length,
            charts: jarvis.charts?.length ?? 0,
            exportRows: jarvis.export?.row_count ?? 0,
          });
          return formatResponse(jarvis);
        }

        if (evt.event === "error") {
          throw new Error((parsed.error as string) || "Jarvis streaming query failed");
        }

        if (onUpdate) {
          if (evt.event === "progress") {
            const mode = parsed.mode as string;
            const message = parsed.message as string;
            const label = mode === "planning" ? "Planning" : "Executing";
            onUpdate({
              content: [{ type: "text", text: `[${label}] ${message}` }],
              details: parsed,
            });
          } else if (evt.event === "tool") {
            const tool = parsed.tool as string;
            if (tool !== "manage_tasks") {
              onUpdate({
                content: [{ type: "text", text: `Running tool: ${tool}` }],
                details: parsed,
              });
            }
          }
        }
      }
    }

    // If we exit the loop without a done event, that's an error
    throw new Error("SSE stream ended without a done event");
  } finally {
    clearTimeout(timeout);
  }
}

function log(level: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const prefix = `${ts} [ask_data_analyst] ${level}:`;
  if (data !== undefined) {
    console.log(prefix, msg, JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, msg);
  }
}

async function executeNonStreaming(
  config: JarvisConfig,
  cid: string,
  question: string,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  const url = `${config.url}/v1/customer/${cid}`;

  log("INFO", `request POST ${url}`, { cid, question });
  const start = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log("ERROR", `response ${res.status} (${Date.now() - start}ms)`, text);
    throw new Error(`Jarvis query failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as JarvisResponse;
  log("INFO", `response 200 (${Date.now() - start}ms)`, {
    responseLength: data.response.length,
    charts: data.charts?.length ?? 0,
    exportRows: data.export?.row_count ?? 0,
  });
  return formatResponse(data);
}

export function createDataQueryTools(config: JarvisConfig) {
  return [
    {
      name: "ask_data_analyst",
      description:
        "Hand off a data question to the Data Analyst agent. " +
        "The analyst has access to BigQuery and can run SQL queries, generate charts, and export data. " +
        "This is an agent-to-agent call — it may take 20-60 seconds. " +
        "Use for questions about properties, bookings, revenue, guests, or any business metrics. " +
        "Examples: 'what was revenue last month?', 'show top properties by bookings', 'how many guests checked in this week?'",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID (e.g. 'twiddy'). Used to scope the query to this client's data." }),
        question: Type.String({ description: "The data question to answer in natural language." }),
      }),
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal?: AbortSignal,
        onUpdate?: OnUpdateCallback,
      ) {
        const cid = params.cid as string;
        const question = params.question as string;

        // Try streaming first, fall back to non-streaming
        if (onUpdate) {
          try {
            return await executeStreaming(config, cid, question, onUpdate);
          } catch (e) {
            // If streaming endpoint is unavailable (404), fall back silently
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("(404)")) {
              return await executeNonStreaming(config, cid, question);
            }
            throw e;
          }
        }

        return await executeNonStreaming(config, cid, question);
      },
    },
  ];
}
