import { Type } from "@sinclair/typebox";
import type { VrmApiClient } from "../api-client.js";

export function createVendorTools(client: VrmApiClient) {
  return [
    {
      name: "vendor_list",
      description: "List available vendors. Filter by service type or location.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        service_type: Type.Optional(
          Type.String({ description: "Filter by service type: cleaning, pool, hvac, laundry, maintenance." }),
        ),
        location: Type.Optional(Type.String({ description: "Filter by location or area." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listVendors({
          cid: params.cid as string,
          service_type: params.service_type as string | undefined,
          location: params.location as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "vendor_availability",
      description: "Check a vendor's schedule and available time slots.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        vendor_id: Type.String({ description: "Vendor ID to check availability for." }),
        date: Type.Optional(Type.String({ description: "Date to check in YYYY-MM-DD format. Defaults to today." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.getVendorAvailability(params.vendor_id as string, {
          cid: params.cid as string,
          date: params.date as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
  ];
}
