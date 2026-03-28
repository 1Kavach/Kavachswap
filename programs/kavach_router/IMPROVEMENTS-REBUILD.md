# Router Rebuild — What’s Not Too Late & What to Add (Easy / Medium / Hard)

**Context:** You’re about to rebuild the router. These are changes that either (1) are **not too late** to do in the program now, or (2) are **accompanying** (index, adapter, dashboard) and when to do them.  
**Your folders:** `126/folder/claudetest` (dashboard), `126/folder/dashtnk` (3D dashboard), `126/folder/indexkavach` (indexer), `126/folder/routers` (specs + Jupiter/adapter docs).

---

## Not too late (do in router before/at rebuild)

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 1 | **Validate Clock sysvar** *(done in this session)* in `route_and_swap` and `route_and_swap_multihop`: require `clock.key == &solana_program::sysvar::clock::id()` (or `clock::check_id(clock.key)`). | **Easy** | Stops clients passing a fake clock to the AMM (audit recommendation). |
| 2 | **Emit a Borsh event for the indexer** *(done: discriminator 6, single-hop only)* after a successful RouteAndSwap/MultiHop: define `RouterSwapEvent` (e.g. user, amm_id, amount_in, minimum_amount_out, pool, timestamp), serialize as `[discriminator] + borsh::to_vec(&event)`, then `solana_program::log::sol_log_data(&[&bytes])`. | **Easy** | Indexer already expects “Program data:” + base64 Borsh. Right now the router only uses `msg!(...)` (program log), so indexer can’t parse router-originated swaps. This lets index + dashboard show “via router” and per-AMM stats. |
| 3 | **Optional `minimum_amount_out_hop1`** in `RouteAndSwapMultiHopArgs` and pass it to hop 1 instead of hardcoded `1u64`. | **Medium** | Gives slippage protection on the first hop; currently only the final hop enforces min out. |
| 4 | **Adapter-style layout** (optional): move CPI logic into a small `adapters` module (e.g. `adapters/mod.rs` + `adapters/core.rs` for slot 3, `adapters/other.rs` for 0–2) so adding a 5th AMM or changing one interface is in one place. | **Medium** | Cleaner code; behavior unchanged. Matches the “adapters” idea in `KAVACH-CUSTOM-ROUTER.md`. |

---

## Index (indexkavach) — do after router emits event

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 5 | **Router event + table:** Add `RouterSwapEvent` in `events.rs` (discriminator aligned with router), `router_swaps` table in SQL (e.g. signature, user, amm_id, amount_in, min_out, pool, timestamp), parse in `parser.rs` when you see that discriminator from router logs, `insert_router_swap` in `storage.rs`, and optionally a Kafka topic `kavach.router_swaps`. | **Medium** | Lets you distinguish “swap via router” vs “direct AMM” and show router volume / AMM mix. Depends on #2 (router must emit the event). |
| 6 | **API + dashboard:** Add REST/GraphQL for router stats (e.g. `/v1/router/swaps`, `routerVolume24h`, `swapsByAmmId`). Dashboard (claudetest/dashtnk) can then call this and show “Router” section. | **Easy** (once #5 is done) | Makes the index useful in the UI. |

---

## Adapter (Jupiter / off-chain)

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 7 | **Jupiter adapter (off-chain):** A separate service/package that implements Jupiter’s DEX adapter interface: discover your router’s pools (from your AMMs), quote, and build swap transactions that call your **router** (RouteAndSwap). Specs in `126/folder/routers` (e.g. KAVACH-CUSTOM-ROUTER, ELITE-ROUTER-2026). | **Hard** | Not part of the on-chain router rebuild. You can add it later; the router program doesn’t need to change for it. Your current router is already “adapter-ready” in the sense that one entry point (RouteAndSwap) and fixed account layout are what an aggregator would call. |

So: **on-chain “adapter”** = the CPI branching you already have (optionally reorganized per #4). **Off-chain adapter** = Jupiter integration later; not too late to do after deploy.

---

## Dashboard (claudetest, dashtnk)

| # | Change | Effort | Why |
|---|--------|--------|-----|
| 8 | **Point dashboards at indexer API:** Configure `kavach_dashboard.html` / 3D dashboard to use indexer REST/GraphQL (e.g. `/v1/pools`, `/v1/swaps`, `/v1/stats`) instead of (or in addition to) any mock/static data. | **Easy–Medium** | So the UI shows live protocol data. |
| 9 | **Router section in dashboard:** After #5 and #6, add a “Router” block: volume via router, swaps by AMM ID, maybe last N router swaps. | **Easy** | Shows that router + index are working. |

---

## Summary

- **Do now (rebuild time):**  
  - **Easy:** #1 Clock validation, #2 Router Borsh event.  
  - **Optional:** #3 min_out hop1, #4 adapter layout.
- **Do after router + event:**  
  - **Index:** #5 router_swaps + parser + storage, #6 API for router stats.  
  - **Dashboard:** #8 wire to API, #9 router section (after #5/#6).
- **Do later (not part of rebuild):**  
  - #7 Jupiter adapter (off-chain); router is already compatible.

You can add **index** and **adapter** later: index needs the router to emit the event (#2); adapter (on-chain) is just code layout (#4), and the Jupiter adapter is a separate off-chain project (#7). None of this “spoils” the original; it only adds features and structure.
