# Kavach Trading API Spec (AI + Bot Friendly)

Version: `v1`
Status: draft for implementation
Cluster support: `devnet`, `mainnet-beta`

This document defines machine-friendly contracts for quote, simulate, execute, and streaming events so AI agents and trading bots can integrate reliably with Kavach.

## Design Goals

- Deterministic request/response schemas
- Idempotent execution
- Stable error codes (not string parsing)
- Explicit fee/risk/slippage fields
- Clean separation between quote/simulate/execute

## Base URL

- Devnet: `https://api.kavachswap.com/devnet/v1`
- Mainnet: `https://api.kavachswap.com/mainnet/v1`

## Auth

Use API key auth for bot traffic.

- Header: `Authorization: Bearer <api_key>`
- Optional request signature header for high-value flows:
  - `X-Kavach-Timestamp: <unix_ms>`
  - `X-Kavach-Signature: <ed25519_sig_base58>`

If request signing is enabled, signature is over:

`<timestamp>.<method>.<path>.<sha256(body)>`

## Idempotency

Execution endpoints require:

- `client_order_id` (string, max 64 chars, unique per account for 24h)

On duplicate `client_order_id`, server returns the original accepted result payload.

## Common Types

### TokenAmount

```json
{
  "mint": "So11111111111111111111111111111111111111112",
  "decimals": 9,
  "amount_raw": "1500000000",
  "amount_ui": "1.5"
}
```

### FeeBreakdown

```json
{
  "protocol_fee_bps": 20,
  "protocol_fee_amount_raw": "12000",
  "lp_fee_bps": 30,
  "lp_fee_amount_raw": "18000",
  "network_fee_lamports_estimate": 5000
}
```

### RouteLeg

```json
{
  "kind": "kavach_core",
  "program_id": "9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM",
  "pool_address": "POOL_PUBKEY",
  "in_mint": "IN_MINT",
  "out_mint": "OUT_MINT"
}
```

## REST Endpoints

## 1) Health

`GET /health`

Response:

```json
{
  "ok": true,
  "cluster": "devnet",
  "slot": 362129991,
  "timestamp": "2026-03-27T04:30:00Z"
}
```

## 2) Quote

`POST /quote`

Request:

```json
{
  "wallet": "WALLET_PUBKEY",
  "in_mint": "IN_MINT",
  "out_mint": "OUT_MINT",
  "amount_in_raw": "1000000",
  "slippage_bps": 100,
  "prefer": ["kavach_core", "kavach_stable", "jupiter"],
  "max_hops": 2
}
```

Response:

```json
{
  "quote_id": "q_01J9R2M2V2C9",
  "expires_at_ms": 1770000000000,
  "amount_in_raw": "1000000",
  "amount_out_estimated_raw": "995000",
  "min_out_raw": "985050",
  "price_impact_bps": 24,
  "route": [
    {
      "kind": "kavach_core",
      "program_id": "9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM",
      "pool_address": "POOL_PUBKEY",
      "in_mint": "IN_MINT",
      "out_mint": "OUT_MINT"
    }
  ],
  "fees": {
    "protocol_fee_bps": 20,
    "protocol_fee_amount_raw": "1990",
    "lp_fee_bps": 30,
    "lp_fee_amount_raw": "2985",
    "network_fee_lamports_estimate": 5000
  },
  "warnings": [
    {
      "code": "QUOTE_APPROXIMATE",
      "message": "Final output is enforced on-chain."
    }
  ]
}
```

## 3) Simulate

`POST /simulate`

Request:

```json
{
  "wallet": "WALLET_PUBKEY",
  "quote_id": "q_01J9R2M2V2C9",
  "client_order_id": "bot-etharb-0008123"
}
```

Response:

```json
{
  "client_order_id": "bot-etharb-0008123",
  "ok": true,
  "compute_units_estimate": 155000,
  "network_fee_lamports_estimate": 7000,
  "amount_out_simulated_raw": "993800",
  "min_out_raw": "985050",
  "logs_sample": [
    "Program ... invoke [1]",
    "Program ... success"
  ]
}
```

## 4) Execute

`POST /execute`

Request:

```json
{
  "wallet": "WALLET_PUBKEY",
  "quote_id": "q_01J9R2M2V2C9",
  "client_order_id": "bot-etharb-0008123",
  "priority_fee_micro_lamports": 25000,
  "skip_preflight": false
}
```

Response:

```json
{
  "client_order_id": "bot-etharb-0008123",
  "status": "submitted",
  "tx_signature": "5sQ...xyz",
  "submitted_at_ms": 1770000000123,
  "explorer_url": "https://solscan.io/tx/5sQ...xyz?cluster=devnet"
}
```

## 5) Execution Status

`GET /execute/{client_order_id}`

Response:

```json
{
  "client_order_id": "bot-etharb-0008123",
  "status": "confirmed",
  "tx_signature": "5sQ...xyz",
  "slot": 362130500,
  "filled": {
    "in_mint": "IN_MINT",
    "out_mint": "OUT_MINT",
    "amount_in_raw": "1000000",
    "amount_out_raw": "994100"
  },
  "fees_paid": {
    "protocol_fee_amount_raw": "1988",
    "network_fee_lamports": 6800
  },
  "confirmed_at_ms": 1770000001234
}
```

## 6) Pool Snapshot

`GET /pools/{pool_address}`

Response:

```json
{
  "pool_address": "POOL_PUBKEY",
  "kind": "kavach_stable",
  "token_a_mint": "MINT_A",
  "token_b_mint": "MINT_B",
  "reserve_a_raw": "1230000000",
  "reserve_b_raw": "4560000000",
  "fee_bps": 4,
  "amp_factor": 100,
  "updated_at_ms": 1770000000000
}
```

## WebSocket Streams

Base: `wss://api.kavachswap.com/stream/v1?cluster=devnet`

Client subscribe message:

```json
{
  "op": "subscribe",
  "channels": [
    "pool:POOL_PUBKEY",
    "swaps:IN_MINT/OUT_MINT",
    "orders:WALLET_PUBKEY"
  ]
}
```

Server event:

```json
{
  "channel": "swaps:IN_MINT/OUT_MINT",
  "event": "swap.executed",
  "ts_ms": 1770000009999,
  "data": {
    "tx_signature": "5sQ...xyz",
    "pool_address": "POOL_PUBKEY",
    "amount_in_raw": "1000000",
    "amount_out_raw": "994100"
  }
}
```

## Error Model

All non-2xx responses:

```json
{
  "error": {
    "code": "SLIPPAGE_EXCEEDED",
    "message": "Expected out below min_out.",
    "retryable": true,
    "details": {
      "min_out_raw": "985050",
      "simulated_out_raw": "981000"
    }
  }
}
```

Stable error codes:

- `INVALID_REQUEST`
- `UNAUTHORIZED`
- `RATE_LIMITED`
- `UNSUPPORTED_MINT`
- `POOL_NOT_FOUND`
- `ROUTE_NOT_FOUND`
- `QUOTE_EXPIRED`
- `SLIPPAGE_EXCEEDED`
- `SIMULATION_FAILED`
- `INSUFFICIENT_BALANCE`
- `BLOCKHASH_EXPIRED`
- `TX_REJECTED`
- `INTERNAL_ERROR`

## Rate Limits

- Public: `60 req/min`
- Auth bot key: `600 req/min`
- Burst: `50 req/10s`
- WebSocket: `max 50 subscriptions per connection`

Headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

## Bot Integration Best Practices

- Always call `/quote` then `/simulate` before `/execute`.
- Use `client_order_id` for every execute call.
- Enforce local max slippage guard in bot logic, even if API enforces it.
- Respect `quote_id` expiry windows.
- Reconcile final fills with `/execute/{client_order_id}`.
- Consume WebSocket events to reduce polling load.

## Notes for Current Kavach Stack

- Core AMM direct and stable AMM paths are first-class.
- Router path may be used internally for optimization, but external API contract stays route-agnostic.
- Jupiter can remain as fallback source while preserving this unified response schema.

