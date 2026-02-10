/** Typed HTTP client for the VRM admin API. */

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ApiError {
  status: number;
  message: string;
}

export class VrmApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VRM API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // --- Work Orders ---

  async listWorkOrders(params: {
    cid: string;
    status?: string;
    property_id?: string;
    service_type?: string;
  }) {
    const query: Record<string, string> = { cid: params.cid };
    if (params.status) query.status = params.status;
    if (params.property_id) query.property_id = params.property_id;
    if (params.service_type) query.service_type = params.service_type;
    return this.request<unknown>("GET", "/work_orders", undefined, query);
  }

  async createWorkOrder(params: {
    cid: string;
    property_id: string;
    service_type: string;
    description: string;
    priority?: string;
    due_date?: string;
  }) {
    return this.request<unknown>("POST", "/work_orders", params);
  }

  async updateWorkOrder(id: string, params: {
    cid: string;
    status?: string;
    notes?: string;
    vendor_id?: string;
  }) {
    return this.request<unknown>("PATCH", `/work_orders/${id}`, params);
  }

  // --- Vendors ---

  async listVendors(params: {
    cid: string;
    service_type?: string;
    location?: string;
  }) {
    const query: Record<string, string> = { cid: params.cid };
    if (params.service_type) query.service_type = params.service_type;
    if (params.location) query.location = params.location;
    return this.request<unknown>("GET", "/vendors", undefined, query);
  }

  async getVendorAvailability(vendorId: string, params: {
    cid: string;
    date?: string;
  }) {
    const query: Record<string, string> = { cid: params.cid };
    if (params.date) query.date = params.date;
    return this.request<unknown>("GET", `/vendors/${vendorId}/availability`, undefined, query);
  }

  // --- Scheduling ---

  async scheduleVendor(workOrderId: string, params: {
    cid: string;
    vendor_id: string;
    scheduled_time: string;
    notes?: string;
  }) {
    return this.request<unknown>("POST", `/work_orders/${workOrderId}/schedule`, params);
  }

  async rescheduleVendor(workOrderId: string, params: {
    cid: string;
    reason?: string;
  }) {
    return this.request<unknown>("POST", `/work_orders/${workOrderId}/reschedule`, params);
  }
}
