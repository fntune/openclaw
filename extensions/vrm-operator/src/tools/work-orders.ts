import { Type } from "@sinclair/typebox";
import type { VrmApiClient } from "../api-client.js";

export function createWorkOrderTools(client: VrmApiClient) {
  return [
    {
      name: "work_order_list",
      description: "List work orders for a client. Filter by status, property, or service type.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID (e.g. 'twiddy')." }),
        status: Type.Optional(
          Type.String({ description: "Filter by status: pending, scheduled, in_progress, completed, cancelled." }),
        ),
        property_id: Type.Optional(Type.String({ description: "Filter by property ID." })),
        service_type: Type.Optional(
          Type.String({ description: "Filter by service type: cleaning, pool, hvac, laundry, maintenance." }),
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.listWorkOrders({
          cid: params.cid as string,
          status: params.status as string | undefined,
          property_id: params.property_id as string | undefined,
          service_type: params.service_type as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "work_order_create",
      description: "Create a new work order for a property.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        property_id: Type.String({ description: "Property ID for the work order." }),
        service_type: Type.String({ description: "Service type: cleaning, pool, hvac, laundry, maintenance." }),
        description: Type.String({ description: "Description of the work to be done." }),
        priority: Type.Optional(Type.String({ description: "Priority: low, normal, high, urgent. Defaults to normal." })),
        due_date: Type.Optional(Type.String({ description: "Due date in YYYY-MM-DD format." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.createWorkOrder({
          cid: params.cid as string,
          property_id: params.property_id as string,
          service_type: params.service_type as string,
          description: params.description as string,
          priority: params.priority as string | undefined,
          due_date: params.due_date as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "work_order_update",
      description: "Update the status or notes on an existing work order.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        work_order_id: Type.String({ description: "Work order ID to update." }),
        status: Type.Optional(
          Type.String({ description: "New status: pending, scheduled, in_progress, completed, cancelled." }),
        ),
        notes: Type.Optional(Type.String({ description: "Notes to add to the work order." })),
        vendor_id: Type.Optional(Type.String({ description: "Assign or reassign a vendor." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.updateWorkOrder(params.work_order_id as string, {
          cid: params.cid as string,
          status: params.status as string | undefined,
          notes: params.notes as string | undefined,
          vendor_id: params.vendor_id as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
  ];
}
