# Wiring Real Data (Free Options)

How to connect the dashboard and React app to **real** TVL, volume, and analytics without paying for an indexer.

---

## 1. What you already have (free)

- **React DEX (Swap, Pools, Liquidity, Create Pool)** — Already use **live on-chain data** via RPC:
  - Pool state, reserves, LP supply, user balances come from `getPoolStateForMints`, `getPoolReserves`, etc. over your configured RPC (`VITE_SOLANA_RPC` or public fallbacks).
  - No extra wiring needed; when pools exist on mainnet, the UI shows real numbers.

- **Dashboard Portfolio** — Uses RPC fallback list (publicnode, drpc, mainnet) so balance and token accounts load without "Access Forbidden."

---

## 2. Dashboard Overview (TVL, 24h volume, recent swaps)

The main dashboard (`index.html`) still shows **$0** for TVL, volume, and "No swaps yet" until you connect a data source. Free options:

### A. On-chain only (no API key)

- **Pool list:** Use `getProgramAccounts` on the Core AMM program (`9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`) with a filter for pool accounts. Parse pool state to get mint A/B, reserves.
- **TVL:** Sum (reserve_A × price_A + reserve_B × price_B) for each pool. You need a **price feed** for SOL and other tokens:
  - Use a **free price API** (e.g. CoinGecko public endpoint for SOL: `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd`) or fix SOL price in code for a rough TVL.
- **Volume / recent swaps:** Requires parsing **transaction history** (swap events). Heavy from RPC; usually needs an indexer or a backend that subscribes to logs.

So: **TVL** is doable free (RPC + public price API). **Volume and recent swaps** are easier with a free-tier indexer or a small backend.

### B. Free API tiers (analytics)

| Service        | Free tier | What you get |
|----------------|-----------|----------------|
| **Birdeye**    | Free tier | Token price, some DEX stats; rate limits apply. |
| **DexScreener**| Public   | Pair stats, TVL, volume by pool address. |
| **Helius**     | Free tier| RPC + webhooks; can build a small backend to track swaps. |
| **Jupiter**    | API      | Quote and route; not for historical TVL/volume. |

- **Dashboard:** Call Birdeye or DexScreener from a **backend** (or from the frontend with CORS-friendly endpoints) to get TVL/volume for your program or pool addresses. Then the dashboard fetches from your backend or from the API and displays it.
- Your old analytics (e.g. `6/dashh`, `5/reverse` test-results) used a **Node server** with `/api/analytics/top10`, trending, etc. Same idea: a small server that fetches from free APIs or indexes chain data and exposes JSON for the dashboard.

### C. Minimal “real data” without a server

1. **SOL price:** Fetch from CoinGecko (or similar) in the dashboard once on load.
2. **Pool count / simple TVL:** If you have a fixed list of pool PDAs, use the existing RPC (or public one) to `getMultipleAccountsInfo` for those pools, parse reserves, multiply by SOL price for SOL-side, and show a single “TVL” number.
3. **Recent swaps:** Omit or show “—” until you add a backend that indexes swap txs (e.g. Helius webhooks + DB) or use a free analytics API that returns swap history for your program.

---

## 3. Steps to wire dashboard TVL (free, no backend)

1. In the dashboard’s script section:
   - Define your Core AMM program ID and, if you have them, known pool PDAs (or derive from a small list of mint pairs).
2. On Overview load (or when opening the dashboard):
   - Fetch SOL price from `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd`.
   - For each pool PDA, call `getAccountInfo` (or `getMultipleAccountsInfo`), decode pool state, read vault balances or reserve fields.
3. Sum SOL value (reserve_sol × SOL price) + other side if you have a price; or approximate TVL as 2 × (reserve_sol × SOL price) for SOL/X pairs.
4. Write the result into `#tvl` (and optionally a small “Pool count” or “Pools” label).

This keeps everything in the frontend, no API keys, no server. For **volume** and **recent swaps**, add later either a free-tier analytics API or a small backend that indexes transactions (e.g. Helius + Node).

---

## 4. Summary

- **React app:** Already uses real on-chain data for pools and liquidity; no change needed.
- **Dashboard TVL:** Use RPC + CoinGecko (or similar) + pool account parsing in the dashboard JS.
- **Dashboard volume / swaps:** Prefer a free API (Birdeye/DexScreener) or a small backend (like your old analytics server) that indexes or fetches swap data and exposes it to the dashboard.

If you want, the next step can be: add a small block in `index.html` that fetches SOL price and one or two known pool PDAs, computes a simple TVL, and updates `#tvl`.

---

## 5. Using your existing RPCs and CoinGecko (6/dashh)

You have RPCs and APIs in **`6/dashh/mantishshrimp3d`** and **`6/dashh/1mantis`** that can feed real data into the Kavach dashboard:

- **`6/dashh/mantishshrimp3d/env.txt`** — Lists QuickNode, Chainstack, Ankr Solana RPCs; **CoinGecko API key** (`COINGECKO_API_KEY`); Moralis, etc. Use these in a **backend** or, for public endpoints only, in the dashboard (e.g. CoinGecko *public* URL for SOL price does not need the key; the key gives higher rate limits).
- **`6/dashh/1mantis/analytics.db`** — SQLite DB from your analytics server. For **realtime analytics** and **website upgrades**, you can run a small Node server (same idea as `6/dashh` or `5/reverse` test server) that:
  - Reads from this DB or reuses the same analytics pipeline.
  - Fetches from your RPCs and CoinGecko (using env from mantishshrimp3d).
  - Exposes JSON for the Kavach dashboard (TVL, volume, top tokens, etc.).
- **`6/dashh`** — Your existing dashboard/analytics code. To reuse for Kavach:
  - Point the server’s RPC and CoinGecko config to the same env (or copy relevant vars into Kavach’s backend if you add one).
  - Add endpoints that return Kavach-specific data (e.g. Core AMM program pools, TVL for those pools) so the Kavach dashboard can call them.

So: **no placeholder TVL** is being added in the dashboard; the figures stay **$0 / empty** until you wire a data source. When you connect real data (your RPCs + CoinGecko, or 6/dashh analytics server), the dashboard will show whatever you feed it.

---

## 6. AMM: “Not finding coins” and stables

- **“AMM isn’t finding coins”** — The AMM **only sees pools that exist on-chain**. If there is **no pool** for the pair you’re selecting (e.g. Token X / SOL), the UI correctly shows “No pool” or no quote. So it’s not that the AMM can’t “find” the coins; it’s that **no pool has been created for that pair yet**. Create one in **Create Pool**, then add liquidity; after that, Swap and Pools will show that pair.
- **This AMM can create pools** — Yes. Use **Create Pool** (Base + Quote + fee tier), then **Add Liquidity** to seed the pool. After that, the pair appears in Pools and Swap.
- **Stables** — The **Kavach Core AMM** is **constant-product (x·y = k)**. It works for any pair, including stablecoins (e.g. USDC/USDT), but for stables the constant-product curve gives more slippage than a **StableSwap (curve)** pool. A separate “Stable AMM” (StableSwap) program would be for stable–stable pairs with low slippage; that’s not in the current verifiable-builds list. So: **with the current Core AMM, stables behave like any other pair** (they work, but you get constant-product slippage unless you add a dedicated stable program later).
