/** HTTP client for the MCP server REST API (Miner endpoints). */

export interface MinerClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class MinerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: MinerClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MCP Miner API ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // --- Customers ---

  async getCustomer(cid: string): Promise<unknown> {
    return this.request("/api/mcp/customers/get", { cid });
  }

  async listCustomers(params: {
    vertical?: string;
    status?: string;
    limit?: string;
    offset?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/customers/list", params as Record<string, string>);
  }

  // --- Properties ---

  async listProperties(params: {
    cid: string;
    search_query?: string;
    limit?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/properties/list", params as Record<string, string>);
  }

  async getProperty(cid: string, listing_id: string): Promise<unknown> {
    return this.request("/api/mcp/properties/get", { cid, listing_id });
  }

  // --- Reservations ---

  async listReservations(params: {
    cid: string;
    search_query?: string;
    limit?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/reservations/list", params as Record<string, string>);
  }

  // --- Contacts ---

  async listContacts(params: {
    cid: string;
    search_query?: string;
    limit?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/contacts/list", params as Record<string, string>);
  }

  async getContact(cid: string, contact_id: string): Promise<unknown> {
    return this.request("/api/mcp/contacts/get", { cid, contact_id });
  }

  // --- Experiments ---

  async listExperimentConfigs(cid: string): Promise<unknown> {
    return this.request("/api/mcp/experiments/list", { cid });
  }

  async getExperimentConfig(cid: string, namespace_id: string): Promise<unknown> {
    return this.request("/api/mcp/experiments/get", { cid, namespace_id });
  }

  // --- Metrics ---

  async getLatestMetrics(params: {
    cid: string;
    product?: string;
    page_type?: string;
    time_interval?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/metrics/latest", params as Record<string, string>);
  }

  async getMetricsHistory(params: {
    cid: string;
    history_records?: string;
    product?: string;
    page_type?: string;
    time_interval?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/metrics/history", params as Record<string, string>);
  }

  // --- Syncer Status ---

  async listSyncerStatus(params: {
    cid: string;
    syncer_name?: string;
    limit?: string;
  }): Promise<unknown> {
    return this.request("/api/mcp/syncer/status", params as Record<string, string>);
  }

  // --- Customer Journey ---

  async getCustomerJourney(cid: string): Promise<unknown> {
    return this.request("/api/mcp/customers/journey", { cid });
  }
}
