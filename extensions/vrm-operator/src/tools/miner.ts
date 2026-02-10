import { Type } from "@sinclair/typebox";
import type { MinerClient } from "../miner-client.js";

export function createMinerTools(client: MinerClient) {
  return [
    {
      name: "customer_get",
      description: "Get customer configuration, status, and enabled features by CID.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID (e.g. 'twiddy')." }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getCustomer(params.cid as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "customer_list",
      description: "List Aidaptive customers. Filter by vertical (hospitality, ecommerce).",
      parameters: Type.Object({
        vertical: Type.Optional(Type.String({ description: "Filter by vertical: hospitality, ecommerce." })),
        limit: Type.Optional(Type.String({ description: "Max results (default 100)." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listCustomers({
          vertical: params.vertical as string | undefined,
          limit: params.limit as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "property_list",
      description: "Search hospitality property listings. Returns listing ID, name, address, bedrooms, bathrooms.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        search_query: Type.Optional(Type.String({ description: "Search by name, address, or property ID." })),
        limit: Type.Optional(Type.String({ description: "Max results (default 20)." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listProperties({
          cid: params.cid as string,
          search_query: params.search_query as string | undefined,
          limit: params.limit as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "property_get",
      description: "Get detailed property information by listing ID. Includes amenities, address, images.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        listing_id: Type.String({ description: "Listing ID to look up." }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getProperty(params.cid as string, params.listing_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "reservation_list",
      description: "Search reservations. Find bookings by guest name, confirmation code, or property.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        search_query: Type.Optional(Type.String({ description: "Search by guest name, confirmation code, or property." })),
        limit: Type.Optional(Type.String({ description: "Max results (default 20)." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listReservations({
          cid: params.cid as string,
          search_query: params.search_query as string | undefined,
          limit: params.limit as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "contact_list",
      description: "Search guest contacts by name or email.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        search_query: Type.Optional(Type.String({ description: "Search by name or email." })),
        limit: Type.Optional(Type.String({ description: "Max results (default 20)." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listContacts({
          cid: params.cid as string,
          search_query: params.search_query as string | undefined,
          limit: params.limit as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "contact_get",
      description: "Get guest contact details (email, phone, name) by contact ID.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        contact_id: Type.String({ description: "Contact ID to look up." }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getContact(params.cid as string, params.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "experiment_configs",
      description: "List all experiment namespaces and their A/B test configs (traffic allocation, models) for a customer.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listExperimentConfigs(params.cid as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "experiment_config",
      description: "Get a specific experiment namespace config by ID (e.g. de_home, de_property, dynamic_search).",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        namespace_id: Type.String({ description: "Namespace ID (e.g. de_home, de_property, dynamic_search)." }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getExperimentConfig(params.cid as string, params.namespace_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "metrics_latest",
      description: "Get latest performance metrics (revenue, CTR, conversions) for a customer's recommendation service.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        product: Type.Optional(Type.String({ description: "Product name (default: predictive_recommendations)." })),
        page_type: Type.Optional(Type.String({ description: "Page type: overall, home, product, cart, property." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getLatestMetrics({
          cid: params.cid as string,
          product: params.product as string | undefined,
          page_type: params.page_type as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "metrics_history",
      description: "Get historical performance metrics over time for a customer.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        history_records: Type.Optional(Type.String({ description: "Number of records to return (default 30)." })),
        product: Type.Optional(Type.String({ description: "Product name (default: predictive_recommendations)." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getMetricsHistory({
          cid: params.cid as string,
          history_records: params.history_records as string | undefined,
          product: params.product as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "syncer_status_list",
      description: "List data sync statuses for a customer. Shows last sync time, batch ID, and sync health per syncer.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        syncer_name: Type.Optional(Type.String({ description: "Filter by syncer name prefix (e.g. 'escapia', 'guesty')." })),
        limit: Type.Optional(Type.String({ description: "Max results (default 20)." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listSyncerStatus({
          cid: params.cid as string,
          syncer_name: params.syncer_name as string | undefined,
          limit: params.limit as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "customer_journey_get",
      description: "Get customer onboarding journey: product setup stages, data integration status, and external system health.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getCustomerJourney(params.cid as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
  ];
}
