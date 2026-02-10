import { Type } from "@sinclair/typebox";
import type { VrmApiClient } from "../api-client.js";

export function createSchedulingTools(client: VrmApiClient) {
  return [
    {
      name: "schedule_vendor",
      description: "Assign a vendor to a work order and set the scheduled time.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        work_order_id: Type.String({ description: "Work order ID to schedule." }),
        vendor_id: Type.String({ description: "Vendor ID to assign." }),
        scheduled_time: Type.String({ description: "Scheduled date and time in ISO 8601 format (e.g. '2026-02-10T09:00:00')." }),
        notes: Type.Optional(Type.String({ description: "Notes for the vendor about the job." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.scheduleVendor(params.work_order_id as string, {
          cid: params.cid as string,
          vendor_id: params.vendor_id as string,
          scheduled_time: params.scheduled_time as string,
          notes: params.notes as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "reschedule_vendor",
      description: "Reschedule a work order — moves to the next available vendor if the current one is unresponsive.",
      parameters: Type.Object({
        cid: Type.String({ description: "Client ID." }),
        work_order_id: Type.String({ description: "Work order ID to reschedule." }),
        reason: Type.Optional(Type.String({ description: "Reason for rescheduling (e.g. 'vendor unresponsive', 'time conflict')." })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await client.rescheduleVendor(params.work_order_id as string, {
          cid: params.cid as string,
          reason: params.reason as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
  ];
}
