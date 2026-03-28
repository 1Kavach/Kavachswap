# When to Build Official Index & Adapter — and What They Are

---

## 1. Min out for hop 1 — what it does and difference with/without

**What it is:** In a **multi-hop** swap (e.g. Token A → Token B → Token C), there are two “hops”:
- **Hop 1:** A → B (you get some amount of B).
- **Hop 2:** B → C (you get some amount of C).

**Right now (without min out for hop 1):**
- The router uses **`minimum_amount_out = 1`** for hop 1 (so almost no slippage protection on the first leg).
- Only the **final** hop uses your real `minimum_amount_out` (slippage protection on the last leg only).

**With “min out for hop 1” (optional improvement):**
- You’d add something like `minimum_amount_out_hop1: u64` to the multi-hop instruction.
- The router would pass that as the minimum output for hop 1. If hop 1 returns **less** than that, the transaction **fails**.
- So you get slippage protection on **both** legs: “at least X from hop 1, at least Y at the end.”

**Difference:**

| | Without min out hop 1 | With min out hop 1 |
|---|------------------------|---------------------|
| Hop 1 | Effectively no min (1 wei) | You set a minimum (e.g. “at least 100 B”) |
| Hop 2 | Your `minimum_amount_out` | Same |
| If hop 1 slips a lot | Tx can still succeed; you just get less B, so less C | Tx **fails** if hop 1 gives less than your min |

So: **without** = simpler, only final output is protected. **With** = safer on both legs, especially when the middle pool is volatile. You can add it later as an optional improvement; it’s not required for index or adapter.

---

## 2. Clock check — is it done and what it means?

**Yes, it’s done.** In the router code you have:

- `route_and_swap`: `if !solana_program::sysvar::clock::check_id(clock.key) { return Err(...) }` (around line 173).
- `route_and_swap_multihop`: same check (around line 268).

**What “clock check” means:**
- The router receives a **clock** account and passes it to the AMM. The AMM uses it to read the current **block time** (for TWAP, fees, expiry, etc.).
- If the **client could pass any account** as “clock,” they could pass a **fake** clock with a wrong timestamp and try to trick the AMM.
- **The check:** `clock::check_id(clock.key)` ensures the account is the **real Solana Clock sysvar**. If it’s not, the instruction fails. So the AMM always gets the real on-chain time.

So: **clock check = only the real Clock sysvar is accepted**, so no fake timestamps. It’s a small but important security fix and it’s already in your router.

---

## 3. When should you build the index?

**Build the index when:**
1. Router (and at least one AMM) are **deployed** (devnet or mainnet).
2. You want a **backend/API** for: volume, “swaps via router,” pool stats, history, dashboard data.

**You don’t need it** for the first “does the swap work?” test; you can test with the Solana CLI or a simple script. You **do** need it when you want the dashboard (or any app) to show live stats and history.

**Suggested order:**
1. Deploy router + AMMs → InitConfig.
2. Test one swap (CLI or script).
3. When you’re ready for dashboards/API → **build/run the official index.**

---

## 4. When should you build the adapter (Jupiter)?

**Build the Jupiter adapter when:**
- You want your DEX to appear **on Jupiter** so users can swap your pools via the Jupiter UI/API.
- Usually after you have **pools with real liquidity** (mainnet or serious devnet).

**You don’t need it** for testing swaps on your own site; the router is enough. The adapter is for **aggregator integration** (Jupiter discovers your pools, quotes, and builds txs that call your router).

**Suggested order:**
1. Router + AMMs deployed, pools created, liquidity added.
2. Your own frontend/dashboard working.
3. When you want Jupiter traffic → **build the official Jupiter adapter.**

---

## 5. Where should the “official” index and adapter live?

| Thing | What it is | Where it could live | Who runs it |
|-------|------------|----------------------|-------------|
| **Official index** | Service that reads chain (your router + AMMs + KVUSD etc.), parses events, writes to DB, exposes REST/GraphQL. | e.g. `126/folder/indexkavach` (you already have structure) or a repo like `kavach-indexer`. | You (or your infra): Docker, K8s, or a VPS. |
| **Official adapter** | Off-chain service that implements **Jupiter’s DEX adapter interface**: list pools, get quote, build swap transaction (calling your router). | e.g. `126/folder/routers/kavach-jupiter-adapter` or a repo like `kavach-jupiter-adapter`. | You deploy it; Jupiter (or your frontend) calls its API. |

So:
- **Official index** = the indexer codebase you treat as canonical (e.g. indexkavach + router_swaps + API). One place, one deployment.
- **Official adapter** = the one Jupiter-facing service/repo you use for Kavach on Jupiter. One place, one deployment.

---

## 6. Can I (the assistant) perform both when the time is right?

**Yes.** When you’re ready:

1. **Index:** I can add to your existing index (e.g. `126/folder/indexkavach`):
   - Parser branch for router event (discriminator 6).
   - `router_swaps` table and storage.
   - API endpoints for router stats (e.g. `/v1/router/swaps`, volume by AMM).
   So the “official index” is that codebase, with router support included.

2. **Adapter:** I can outline or implement the **official Jupiter adapter**:
   - Repo/service structure.
   - Pool discovery (your AMMs’ pools).
   - Quote (best route via your router).
   - Build swap tx (RouteAndSwap / MultiHop with correct accounts).
   In a clear place (e.g. `126/folder/routers/kavach-jupiter-adapter` or its own repo).

You said the index and adapter aren’t up yet — that’s fine. **When to build:**
- **Index:** When you have deployed router/AMMs and want dashboard/API (I can do the router part on top of indexkavach).
- **Adapter:** When you want Jupiter integration (I can do the adapter implementation).

You don’t have to build them before your next router build. Next step is: **rebuild the router** (with clock check + router event already in code), deploy, test swap, then add index (and later adapter) when you’re ready.
