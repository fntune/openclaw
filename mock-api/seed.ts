export interface Vendor {
  id: string;
  cid: string;
  name: string;
  service_type: string;
  phone: string;
  email: string;
  location: string;
  rating: number;
  availability: TimeSlot[];
}

export interface TimeSlot {
  date: string;
  start: string;
  end: string;
  booked: boolean;
}

export interface WorkOrder {
  id: string;
  cid: string;
  property_id: string;
  service_type: string;
  description: string;
  priority: string;
  status: string;
  vendor_id: string | null;
  scheduled_time: string | null;
  due_date: string | null;
  notes: string[];
  created_at: string;
  updated_at: string;
}

let nextWorkOrderId = 1006;

export function nextId(): string {
  return `wo-${nextWorkOrderId++}`;
}

export const vendors: Vendor[] = [
  {
    id: "v-001",
    cid: "twiddy",
    name: "Outer Banks Clean Co.",
    service_type: "cleaning",
    phone: "+12525551001",
    email: "dispatch@obxclean.com",
    location: "Corolla",
    rating: 4.8,
    availability: [
      { date: "2026-02-10", start: "08:00", end: "12:00", booked: false },
      { date: "2026-02-10", start: "13:00", end: "17:00", booked: true },
      { date: "2026-02-11", start: "08:00", end: "12:00", booked: false },
      { date: "2026-02-11", start: "13:00", end: "17:00", booked: false },
    ],
  },
  {
    id: "v-002",
    cid: "twiddy",
    name: "Crystal Clear Pools",
    service_type: "pool",
    phone: "+12525551002",
    email: "service@crystalpools.com",
    location: "Duck",
    rating: 4.6,
    availability: [
      { date: "2026-02-10", start: "07:00", end: "11:00", booked: false },
      { date: "2026-02-10", start: "12:00", end: "16:00", booked: false },
      { date: "2026-02-11", start: "07:00", end: "11:00", booked: true },
    ],
  },
  {
    id: "v-003",
    cid: "twiddy",
    name: "Coastal HVAC Pros",
    service_type: "hvac",
    phone: "+12525551003",
    email: "jobs@coastalhvac.com",
    location: "Corolla",
    rating: 4.9,
    availability: [
      { date: "2026-02-10", start: "09:00", end: "12:00", booked: false },
      { date: "2026-02-11", start: "09:00", end: "12:00", booked: false },
      { date: "2026-02-11", start: "13:00", end: "17:00", booked: true },
    ],
  },
  {
    id: "v-004",
    cid: "twiddy",
    name: "Beach Breeze Laundry",
    service_type: "laundry",
    phone: "+12525551004",
    email: "pickup@beachlaundry.com",
    location: "Kill Devil Hills",
    rating: 4.5,
    availability: [
      { date: "2026-02-10", start: "06:00", end: "14:00", booked: false },
      { date: "2026-02-11", start: "06:00", end: "14:00", booked: false },
    ],
  },
  {
    id: "v-005",
    cid: "twiddy",
    name: "Sandy Shores Maintenance",
    service_type: "maintenance",
    phone: "+12525551005",
    email: "repairs@sandyshores.com",
    location: "Corolla",
    rating: 4.7,
    availability: [
      { date: "2026-02-10", start: "08:00", end: "17:00", booked: false },
      { date: "2026-02-11", start: "08:00", end: "17:00", booked: false },
    ],
  },
];

export const workOrders: WorkOrder[] = [
  {
    id: "wo-1001",
    cid: "twiddy",
    property_id: "prop-201",
    service_type: "cleaning",
    description: "Full turnover clean — guests checking out 10am, next check-in 4pm.",
    priority: "high",
    status: "pending",
    vendor_id: null,
    scheduled_time: null,
    due_date: "2026-02-10",
    notes: [],
    created_at: "2026-02-08T10:00:00Z",
    updated_at: "2026-02-08T10:00:00Z",
  },
  {
    id: "wo-1002",
    cid: "twiddy",
    property_id: "prop-305",
    service_type: "pool",
    description: "Weekly pool chemical balance check and filter cleaning.",
    priority: "normal",
    status: "scheduled",
    vendor_id: "v-002",
    scheduled_time: "2026-02-10T07:00:00",
    due_date: "2026-02-10",
    notes: ["Chemicals in pool house closet"],
    created_at: "2026-02-07T14:30:00Z",
    updated_at: "2026-02-08T09:00:00Z",
  },
  {
    id: "wo-1003",
    cid: "twiddy",
    property_id: "prop-201",
    service_type: "hvac",
    description: "Heating not working in master bedroom — guest reported cold air only.",
    priority: "urgent",
    status: "in_progress",
    vendor_id: "v-003",
    scheduled_time: "2026-02-08T14:00:00",
    due_date: "2026-02-08",
    notes: ["Vendor en route", "Access code: 4521"],
    created_at: "2026-02-08T08:15:00Z",
    updated_at: "2026-02-08T13:45:00Z",
  },
  {
    id: "wo-1004",
    cid: "twiddy",
    property_id: "prop-412",
    service_type: "laundry",
    description: "Pickup and delivery — 12 sets of linens for weekend turnover.",
    priority: "normal",
    status: "completed",
    vendor_id: "v-004",
    scheduled_time: "2026-02-07T06:00:00",
    due_date: "2026-02-07",
    notes: ["Picked up 12 sets", "Delivered clean linens at 2pm"],
    created_at: "2026-02-06T16:00:00Z",
    updated_at: "2026-02-07T14:30:00Z",
  },
  {
    id: "wo-1005",
    cid: "twiddy",
    property_id: "prop-305",
    service_type: "maintenance",
    description: "Deck railing loose on ocean-facing side — safety concern.",
    priority: "high",
    status: "pending",
    vendor_id: null,
    scheduled_time: null,
    due_date: "2026-02-11",
    notes: ["Reported by guest via property app"],
    created_at: "2026-02-08T11:30:00Z",
    updated_at: "2026-02-08T11:30:00Z",
  },
];
