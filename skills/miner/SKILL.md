---
name: miner
description: Query Aidaptive Miner data — customers, properties, reservations, contacts, and performance metrics. Use when a user asks about client configurations, property listings, guest bookings, contact details, or recommendation performance.
---

# Miner Data Skill

## Overview

Query the Aidaptive Miner platform for customer data, hospitality listings, reservations, guest contacts, and performance metrics. Uses the VRM plugin's Miner tools which call Miner's REST API.

## Available Tools

Use these tools directly — they are registered by the VRM Operator plugin:

| Tool | What it does | Required params |
|------|-------------|-----------------|
| `customer_get` | Customer config, status, vertical, enabled features | `cid` |
| `customer_list` | List customers filtered by vertical/status | `vertical?`, `limit?` |
| `property_list` | Search hospitality property listings | `cid`, `search_query?`, `limit?` |
| `property_get` | Get property details by ID | `cid`, `property_id` |
| `reservation_list` | Search reservations by guest/confirmation/property | `cid`, `search_query?`, `limit?` |
| `contact_list` | Search guest contacts by name or email | `cid`, `search_query?`, `limit?` |
| `contact_get` | Get contact details by ID | `cid`, `contact_id` |
| `metrics_latest` | Latest recommendation metrics (revenue, CTR) | `cid`, `product?`, `page_type?` |
| `metrics_history` | Historical metrics over time | `cid`, `history_records?`, `product?` |

## CID (Client ID)

Every tool requires a `cid` parameter identifying the client. The tenant enforcement hook auto-injects CID for single-tenant agents and validates it for multi-tenant agents.

Common CIDs:
- `twiddy` — Twiddy & Company (OBX vacation rentals)
- Use `customer_list` to discover others

## Workflow

1. **Identify what the user wants**: customer info, property data, reservations, contacts, or metrics
2. **Call the appropriate tool** with the CID and any search/filter params
3. **Format the response** clearly — use tables for lists, summaries for single records
4. **Cross-reference when useful**: e.g. look up a property mentioned in a reservation, or check metrics for a customer after viewing their config

## Examples

**"Show me twiddy's properties"** → `property_list` with `cid=twiddy`

**"Find reservations for John Smith"** → `reservation_list` with `cid=twiddy`, `search_query=John Smith`

**"How are twiddy's recommendations performing?"** → `metrics_latest` with `cid=twiddy`

**"Show me the last 7 days of metrics"** → `metrics_history` with `cid=twiddy`, `history_records=7`

**"What's the status of customer shopify-acme?"** → `customer_get` with `cid=shopify-acme`

## Metrics Products

Default is `PREDICTIVE_RECOMMENDATIONS`. Other options:
- `PREDICTIVE_SEARCH`
- `PREDICTIVE_MERCHANDISING`
- `FEATURED_IMAGE_SELECTION`
- `SALES_BOOSTER`

## Page Types

`OVERALL` (default), `HOME`, `PRODUCT`, `CART`, `PROPERTY`
