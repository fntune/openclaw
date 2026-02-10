import express from "express";
import { vendors, workOrders, nextId, type WorkOrder } from "./seed.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.VRM_ADMIN_API_KEY ?? "dev-mock-key";

// Health check (before auth — needed by Docker/systemd health checks)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "vrm-mock-api" });
});

// Auth middleware
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// --- Work Orders ---

app.get("/work_orders", (req, res) => {
  const { cid, status, property_id, service_type } = req.query;
  if (!cid) {
    res.status(400).json({ error: "cid is required" });
    return;
  }

  let result = workOrders.filter((wo) => wo.cid === cid);
  if (status) result = result.filter((wo) => wo.status === status);
  if (property_id) result = result.filter((wo) => wo.property_id === property_id);
  if (service_type) result = result.filter((wo) => wo.service_type === service_type);

  res.json({ work_orders: result, total: result.length });
});

app.post("/work_orders", (req, res) => {
  const { cid, property_id, service_type, description, priority, due_date } = req.body;
  if (!cid || !property_id || !service_type || !description) {
    res.status(400).json({ error: "cid, property_id, service_type, and description are required" });
    return;
  }

  const now = new Date().toISOString();
  const wo: WorkOrder = {
    id: nextId(),
    cid,
    property_id,
    service_type,
    description,
    priority: priority ?? "normal",
    status: "pending",
    vendor_id: null,
    scheduled_time: null,
    due_date: due_date ?? null,
    notes: [],
    created_at: now,
    updated_at: now,
  };
  workOrders.push(wo);
  res.status(201).json(wo);
});

app.patch("/work_orders/:id", (req, res) => {
  const { cid, status, notes, vendor_id } = req.body;
  if (!cid) {
    res.status(400).json({ error: "cid is required" });
    return;
  }

  const wo = workOrders.find((w) => w.id === req.params.id && w.cid === cid);
  if (!wo) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  if (status) wo.status = status;
  if (notes) wo.notes.push(notes);
  if (vendor_id) wo.vendor_id = vendor_id;
  wo.updated_at = new Date().toISOString();

  res.json(wo);
});

// --- Vendors ---

app.get("/vendors", (req, res) => {
  const { cid, service_type, location } = req.query;
  if (!cid) {
    res.status(400).json({ error: "cid is required" });
    return;
  }

  let result = vendors.filter((v) => v.cid === cid);
  if (service_type) result = result.filter((v) => v.service_type === service_type);
  if (location) {
    const loc = (location as string).toLowerCase();
    result = result.filter((v) => v.location.toLowerCase().includes(loc));
  }

  // Strip availability from list response
  const summary = result.map(({ availability: _, ...v }) => v);
  res.json({ vendors: summary, total: summary.length });
});

app.get("/vendors/:id/availability", (req, res) => {
  const { cid, date } = req.query;
  if (!cid) {
    res.status(400).json({ error: "cid is required" });
    return;
  }

  const vendor = vendors.find((v) => v.id === req.params.id && v.cid === cid);
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  let slots = vendor.availability;
  if (date) {
    slots = slots.filter((s) => s.date === date);
  }

  res.json({
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    slots: slots.filter((s) => !s.booked),
    all_slots: slots,
  });
});

// --- Scheduling ---

app.post("/work_orders/:id/schedule", (req, res) => {
  const { cid, vendor_id, scheduled_time, notes } = req.body;
  if (!cid || !vendor_id || !scheduled_time) {
    res.status(400).json({ error: "cid, vendor_id, and scheduled_time are required" });
    return;
  }

  const wo = workOrders.find((w) => w.id === req.params.id && w.cid === cid);
  if (!wo) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  const vendor = vendors.find((v) => v.id === vendor_id && v.cid === cid);
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  wo.vendor_id = vendor_id;
  wo.scheduled_time = scheduled_time;
  wo.status = "scheduled";
  if (notes) wo.notes.push(notes);
  wo.updated_at = new Date().toISOString();

  res.json({
    work_order: wo,
    vendor: { id: vendor.id, name: vendor.name, phone: vendor.phone },
    message: `Scheduled ${vendor.name} for ${wo.service_type} at ${scheduled_time}`,
  });
});

app.post("/work_orders/:id/reschedule", (req, res) => {
  const { cid, reason } = req.body;
  if (!cid) {
    res.status(400).json({ error: "cid is required" });
    return;
  }

  const wo = workOrders.find((w) => w.id === req.params.id && w.cid === cid);
  if (!wo) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  const previousVendorId = wo.vendor_id;
  wo.notes.push(`Rescheduled from vendor ${previousVendorId ?? "none"}${reason ? `: ${reason}` : ""}`);

  // Find next available vendor of same service type (excluding previous)
  const nextVendor = vendors.find(
    (v) => v.cid === cid && v.service_type === wo.service_type && v.id !== previousVendorId,
  );

  wo.vendor_id = nextVendor?.id ?? null;
  wo.scheduled_time = null;
  wo.status = nextVendor ? "pending" : "pending";
  wo.updated_at = new Date().toISOString();

  res.json({
    work_order: wo,
    previous_vendor_id: previousVendorId,
    next_vendor: nextVendor ? { id: nextVendor.id, name: nextVendor.name } : null,
    message: nextVendor
      ? `Moved to ${nextVendor.name}. Needs scheduling.`
      : "No alternative vendor found for this service type.",
  });
});



app.listen(PORT, () => {
  console.log(`VRM mock API running on port ${PORT}`);
  console.log(`  Work orders: ${workOrders.length}`);
  console.log(`  Vendors: ${vendors.length}`);
});
