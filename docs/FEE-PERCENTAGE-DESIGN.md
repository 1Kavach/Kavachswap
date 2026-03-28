# Percentage-Based Fees (Token Creation & Pool Creation)

You asked: **charge a percentage instead of fixed SOL** for token creation and (optionally) for creating a pool. Here’s how it fits your setup and what changes.

---

## 1. Token creation: percentage instead of 0.016 SOL

### Is it harder?

**No.** It’s the same flow; only the **formula** for the fee changes. Still frontend-only (one transfer to `PROTOCOL_TREASURY` before SPL create instructions).

### What “percentage” means here

- **Option A (recommended):** Percentage of **the SOL the user spends in that transaction** (rent for mint + ATA + any other rent in the tx).  
  - Example: total rent = 0.05 SOL, fee = 2% → protocol gets 0.001 SOL.  
  - You already know mint rent and can compute ATA rent; sum them, then `protocol_fee_lamports = total_rent_lamports * FEE_BPS / 10_000`.  
  - Add a **floor** (e.g. min 0.001 SOL) and/or **cap** (e.g. max 0.05 SOL) so tiny txs don’t pay nothing and huge txs don’t get hit too hard.

- **Option B:** Percentage of **something else** (e.g. a fixed “creation cost” you define). Same idea: `fee = base * bps / 10_000` in the frontend.

### What changes in your setup

| Item | Before (fixed) | After (percentage) |
|------|----------------|--------------------|
| Constants | `TOKEN_CREATION_FEE_LAMPORTS = 16_000_000` | e.g. `TOKEN_CREATION_FEE_BPS = 200` (2%) and optional `MIN/MAX_LAMPORTS` |
| Frontend | One transfer with fixed lamports | Compute `totalRent` (mint + ATA), then `fee = totalRent * BPS / 10_000`, clamp to min/max, then one transfer |
| On-chain | No change | No change |

So: **one constant change, one small logic change in the create-token flow.** No new programs, no new accounts.

---

## 2. Pool creation: charge a percentage to make the pool

You already have **50/50 swap fees** in the AMM (Core plan). You’re asking: can you also charge a **percentage** when someone **creates** the pool (initial LP)?

### Two ways to do it

**A) Percentage of SOL (rent) to create the pool**

- When the user calls `initialize_pool`, they pay rent for: pool PDA + token_a_vault + token_b_vault + lp_mint. That’s a fixed SOL amount per pool.
- **Frontend:** Compute total rent (you can estimate from account sizes), then `protocol_fee_lamports = rent * POOL_CREATION_FEE_BPS / 10_000`. Add a **transfer** to `PROTOCOL_TREASURY` before the `initialize_pool` instruction (same pattern as token creation).  
- **AMM program:** No change. You don’t need to change the new Core AMM; the fee is just an extra SOL transfer in the same transaction.
- **Verdict:** Easy. Same as token creation: percentage in the frontend, one transfer. Small percentage (e.g. 0.5%–2%) of rent is reasonable.

**B) Percentage of initial liquidity (tokens)**

- When the user adds the **first** liquidity, you take a small % of `amount_a` and `amount_b` and send to protocol (or to a fee recipient).  
- This **does** require AMM program changes: in `add_liquidity`, when `lp_supply == 0`, compute e.g. `fee_a = amount_a * BPS / 10_000`, `fee_b = amount_b * BPS / 10_000`, transfer those to protocol, then use `(amount_a - fee_a)` and `(amount_b - fee_b)` for the actual pool deposit.  
- More invasive (math + two extra transfers per first add_liquidity). Doable, but not required for “charge a percentage to make the pool” if you’re fine with **percentage of SOL (rent)**.

**Recommendation:** Start with **percentage of SOL (rent)** for pool creation (Option A). Same pattern as token creation, no AMM code change. If later you want a cut of initial liquidity, add Option B in Core.

---

## 3. Summary

| Fee | Charge by | Harder? | Change |
|-----|-----------|---------|--------|
| **Token creation** | Percentage of SOL in tx (e.g. rent) | No | Constants + frontend formula + one transfer |
| **Pool creation** | Percentage of SOL (rent) for init | No | Frontend: compute % of rent, transfer before init; AMM unchanged |
| **Pool creation** | Percentage of first liquidity (tokens) | A bit | AMM: add_liquidity takes a small % and sends to protocol |

The new Core AMM already has **50/50 swap fees**; that’s separate and unchanged. Adding **percentage-based token-creation fee** and **percentage-based pool-creation fee (on rent)** keeps your setup simple and doesn’t require new on-chain logic.

---

## 4. Router (how it works) and pool-creation fees per AMM

### Router in short

- **Config:** One PDA (seeds = `[b"config"]`) holds **4 AMM program IDs**: slot 0 = 8tier, 1 = stable, 2 = CLMM, 3 = Core.
- **RouteAndSwap:** Caller passes `amm_id` (0–3), pool, vaults, user token accounts, **two** token program accounts (for Core pass both; for 8tier/stable/CLMM pass the same program twice), and **clock**. Router builds the right swap instruction for that AMM and CPIs to it. No custody; router only forwards the call.
- **What “clock” is:** **Clock** is a Solana **sysvar** (system account) that gives the current slot and Unix timestamp. The AMM uses it to store when a swap or LP action happened (e.g. `last_update_timestamp`). It’s read-only; the caller includes it in the account list so the router can pass it through to the AMM. So “clock” = one of the 11 accounts, not an extra fee or restriction.
- **What “11 accounts total” means:** The RouteAndSwap **instruction** takes exactly **11 accounts** in this order: (1) config PDA, (2) user (signer), (3) amm_program, (4) pool, (5) vault_in, (6) vault_out, (7) user_token_in, (8) user_token_out, (9) token_program_a, (10) token_program_b, (11) clock. The router then passes a **subset** of those (8 or 9) into the AMM’s swap instruction. So “11” is the **router’s** account count; the AMM sees 8 (8tier/stable/CLMM) or 9 (Core).
- **Core vs rest:** Core’s swap expects 9 accounts (includes `token_program_b` for Token-2022). 8tier, stable, CLMM expect 8 accounts (one token program). The router picks 8 or 9 depending on `amm_id`.

### Pool creation fee: 1 free, 3 at 0.02 SOL

| AMM    | Pool creation protocol fee | Note                    |
|--------|----------------------------|-------------------------|
| 8tier  | **0** (free)               | User pays rent only     |
| Core   | 0.02 SOL                   | Frontend adds transfer  |
| stable | 0.02 SOL                   | Frontend adds transfer  |
| CLMM   | 0.02 SOL                   | Frontend adds transfer  |

Same idea for all three: before calling `initialize_pool`, if `POOL_CREATION_FEE_LAMPORTS[amm] > 0`, frontend adds a transfer of that many lamports to `PROTOCOL_TREASURY`. No change inside the AMM programs.

---

## 5. Raydium-style fee vs percentage

**“Raydium-style fee”** usually means the **swap fee tier list** (what we put in Core): fixed set of allowed fees at pool init, e.g. 0.01%, 0.05%, 0.1%, 0.25%, 0.5%, 0.8%, 1%, 1.25%, 1.5%, 2%, 2.5%, 3%, 4%. Creator picks one; that’s the pool’s swap fee. So “Raydium-style” = **tier list**, not “percentage of something variable.”

**Percentage (for pool creation)** is different: fee = **X% of rent** (or of something else). That would look like:

- **Constants:** e.g. `POOL_CREATION_FEE_BPS.core = 200` (2% of rent), plus `POOL_CREATION_FEE_MIN_LAMPORTS` and `POOL_CREATION_FEE_MAX_LAMPORTS`.
- **Frontend:** When building the “create pool” tx for Core/stable/CLMM:
  1. Estimate or fetch **rent** for that pool type (pool account + vaults + LP mint; stable/CLMM have different sizes).
  2. `fee_lamports = rent_lamports * POOL_CREATION_FEE_BPS[amm] / 10_000`.
  3. Clamp to min/max, then add one transfer of `fee_lamports` to `PROTOCOL_TREASURY` before `initialize_pool`.

So you can have **both**:

- **Swap fee:** Raydium-style **tier list** (Core already has it; 8tier has its own 8 tiers).
- **Pool creation fee:** Either **fixed** (0.02 SOL for core/stable/clmm) or **percentage of rent** (BPS + min/max). Percentage isn’t harder; same pattern as token-creation percentage, just use the pool’s rent instead of mint+ATA rent.

---

## 6. Minimums, maximums, and caps (makers, LPs, buyers)

**There is no cap** on how many makers, liquidity providers, or token buyers can use your AMMs. No “max 100 LPs per pool,” no “max pool size,” no “max swaps per day.”

**What the programs do have:**

- **User-set minimums (slippage protection), not protocol limits:**  
  - **Swap:** `minimum_amount_out` — “I accept no less than X tokens out.” If the computed output is below that, the tx fails. That’s **your** floor for that trade, not a global cap.  
  - **Add liquidity:** `min_lp_tokens` — “I accept no fewer than X LP tokens.”  
  - **Remove liquidity:** `min_amount_a`, `min_amount_b` — “I accept no less than X of token A and Y of token B.”  
  So the only “minimums” are **per-transaction** and chosen by the user to protect against slippage. The protocol does not impose a minimum or maximum on pool size, number of LPs, or number of traders.

- **Rust/Solana limits:** Amounts are `u64` (and some math in `u128`). So in theory the largest token amount is about 18e18 in base units. That’s a technical upper bound, not a business “cap.” No one hits it in practice.

**Summary:** Your AMMs can support as many makers, LPs, and buyers as the chain and the pools allow. No protocol cap on participants or liquidity size; only user slippage minimums and normal u64 ranges.

---

## 7. Is 11 accounts good? How most routers work + status of 126/folder/routers

**Is 11 good?** Yes. Many on-chain routers use a **fixed** account list per instruction so the client always sends the same number of accounts and the program doesn’t need to parse “remaining” accounts. Your router’s RouteAndSwap takes **11 accounts** in a fixed order; it then passes 8 (for 8tier/stable/CLMM) or 9 (for Core) into the AMM. That’s a standard pattern: one entry point, one account layout, predictable compute. Jupiter and other aggregators also use fixed or bounded account layouts for their swap instructions. So **11 is fine** and in line with how most routers work.

**Alternative:** Some designs use **variable** “remaining accounts” (the client sends config + user + … then “all AMM accounts”; the router iterates and each AMM adapter reads what it needs). That’s more flexible but more complex and harder to audit. Your choice (fixed 11) is simpler and safe.

**What’s in `126/folder/routers`:** Reference specs and designs, not the deployed program.

| File | What it is | Relation to deployed router |
|------|------------|-----------------------------|
| **ROUTER-SPEC-KAVACH.md** | Spec for a router over **3 AMMs** (8tier, stable, CLMM), no Core. Same idea: config with AMM program IDs, RouteAndSwap with amm_id, 8 accounts per AMM swap (pool, vaults, user tokens, token_program, clock). | Matches the **pattern** of your deployed router; your router is 4 AMMs and uses 11 accounts (so Core can get 9). |
| **KAVACH-CUSTOM-ROUTER.md** | A **different** design: 4 AMMs with **per-AMM adapters** (amm_one, amm_two, amm_three, amm_four). RouteAndSwap takes base accounts + **remaining_accounts**; each adapter pulls accounts from an iterator. AMM 1/2/3/4 have **different** account layouts (e.g. 8 vs 12). Includes off-chain quote service, TypeScript SDK, events. | Spec/code-in-doc only; not the same as `126/DExs/Kavach/programs/kavach_router`. More flexible (variable accounts) but more complex. |
| **ELITE-ROUTER-2026.md** | “Elite” **multi-DEX** router (Raydium, Orca, Meteora, Phoenix, etc.), up to 16 DEX slots, multi-hop, split routes, MEV/Jito. RouteAndSwap uses **route_data** + remaining accounts. | Reference for future upgrades; not your current in-repo router. |

**Deployed router status:** The **live** router is **`126/DExs/Kavach/programs/kavach_router`**: raw Rust, 4 AMMs (8tier, stable, CLMM, Core), InitConfig with 4 program IDs, RouteAndSwap with **11 accounts** and amm_id 0–3. Core (amm_id=3) gets 9 accounts (including token_program_b). It passes `cargo check`. The folder `126/folder/routers` is **reference material**; the code you build and deploy is in `programs/kavach_router`.

**Your router vs Jupiter / 2 DEX protocols:** See **`126/folder/routers/ROUTER-STRATEGY-YOUR-ROUTER-VS-JUPITER.md`** for: why you need your own router (you can’t “use” Jupiter’s program), using your router for 2 different DEX protocols + your AMM elsewhere, and Jupiter as best reference.

**Full router spec + comparison with 5 DEX routers:** See **`126/folder/routers/KAVACH-ROUTER-SPEC-AND-COMPARISON.md`** for: your router’s full details (state, instructions, accounts, errors), comparison with Jupiter, Raydium, Orca, Meteora, Phoenix, and what’s missing (needed vs not needed).
