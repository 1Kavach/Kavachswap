# Protocol status & pool creation fee (0.02 SOL vs percentage)

## 1. Would LPs pay if you didn’t charge? How much?

**Yes.** Creating a pool on Solana always costs **rent** — the payer must fund the new accounts (pool PDA, two vaults, LP mint). The program doesn’t charge that; the **network** does. So:

- **If you charge 0 protocol fee:** LPs still pay **rent only**.
- **Rent for one 8tier/Core-style pool** (from your program sizes):
  - Pool state: 346 bytes  
  - Token account (vault): 165 bytes × 2  
  - LP mint: 82 bytes  
  Total ≈ **5.6e6 lamports ≈ 0.0056 SOL** (order of magnitude; exact value from `getMinimumBalanceForRentExemption` at runtime).

So **if you don’t charge:** LPs pay **~0.005–0.006 SOL** (rent only).  
**If you charge 0.02 SOL:** LPs pay **rent + 0.02 SOL** → total **~0.025–0.026 SOL**. So 0.02 SOL is roughly **~80% of the total** they pay, or **~350% of rent** (about 3.5× the rent).

---

## 2. What is 0.02 SOL in percentage?

- **As % of rent:** 0.02 / 0.0056 ≈ **~360%** of rent (so “0.02 SOL” is like “360% of rent”).
- **As % of total LP cost (rent + fee):** 0.02 / (0.0056 + 0.02) ≈ **~78%** of what they pay.

So a **fixed 0.02 SOL** is a large slice of the total when rent is small. A **percentage of rent** (e.g. 50% or 100%) would scale: if rent goes up, your fee goes up proportionally; if rent is low, the fee stays small.

---

## 3. Should you use 0.02 SOL or a percentage? Would percentage add complexity?

| Approach | Pros | Cons |
|----------|-----|------|
| **Fixed 0.02 SOL** | Simple, predictable, easy to explain (“LPs pay 0.02 SOL to create a pool”). | Doesn’t scale with rent; if rent changes, 0.02 might feel high or low. |
| **Percentage of rent** | Scales with actual cost; “you pay X% of the pool creation cost” is fair. | Slightly more logic in the frontend (compute rent, then fee = rent × BPS / 10_000). |

**Complexity:** Percentage is **not meaningfully harder**. You already have the pattern for token creation (BPS + min/max). For pool creation it’s the same: frontend estimates or fetches rent, then `fee = rent * POOL_CREATION_FEE_BPS / 10_000`, clamp to min/max, add one transfer before `initialize_pool`. No AMM program change.

**Recommendation:**
- If you want a **simple, fixed** rule: use **0.02 SOL**. One constant, one transfer. Easy.
- If you want it to **track cost**: use **percentage of rent** (e.g. 100% or 200% of rent) with a small min (e.g. 0.001 SOL) and a cap (e.g. 0.05 SOL). Same level of effort as you already did for token creation.

---

## 4. Protocol status @ 126/DExs — how close to complete?

| Component | Status | Notes |
|-----------|--------|--------|
| **Kavach frontend** | ✅ Ready | Swap (Jupiter), Token Factory (SPL + fee), Liquidity/Pools (Raydium). |
| **Token creation fee** | ✅ Done | Fixed or percentage (BPS); PROTOCOL_TREASURY. |
| **8tier AMM** | ✅ Built | 8 fee tiers, 50/50, `cargo check` passes. Not yet wired in UI for “create pool” on your AMM. |
| **Stable AMM** | ✅ Built | Curve-style, 50/50. |
| **CLMM AMM** | ✅ Built | Concentrated liquidity, 50/50. |
| **Router** | 🔶 Stub | 3 AMM slots (8tier, stable, CLMM). Jupiter used for swap today. |
| **Kavach Core** | 📋 Planned | New program: copy 8tier + Raydium-style tiers + mixed Token-2022. Plan in `KAVACH-CORE-PLAN.md`; not implemented yet. |
| **Pool creation in UI** | 🔶 Partial | “Create pool” for **your** AMMs (8tier/stable/CLMM/Core) not fully in the frontend; liquidity tab points to Raydium. |
| **Deploy programs** | 📋 Pending | Build + deploy 8tier/stable/CLMM/router (and later Core) to devnet/mainnet. |
| **KVH / KVUSD** | 📋 Later | Launch KVH after site live; KVUSD after KVH. |

**Summary:** The **AMMs and router are implemented and cargo-checked**. What’s left for “complete” on the DEX side:

1. **Deploy** the programs (8tier, stable, CLMM, router) and set program IDs in the app.
2. **Frontend “Create pool”** for your AMMs: build the init + add_liquidity flows so LPs can create pools on 8tier (or Core when it exists) instead of only Raydium.
3. **Optional:** Pool creation fee (0.02 SOL or % of rent) in that flow — same pattern as token creation: add transfer to PROTOCOL_TREASURY before `initialize_pool`.
4. **Later:** Implement Kavach Core (tiers + Token-2022) and add it as the 4th router AMM.

So: **programs are close to complete;** “full” completion is deploy + wiring “create pool” (and optional pool fee) in the UI.
