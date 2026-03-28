# Kavach Core — Plan (no code yet)

**Purpose:** Copy 8tier, match Raydium-style fee tiers, add mixed Token-2022 support, and integrate as the router’s “core” AMM. This doc is the plan only; implementation comes later.

**References:** `126/files/soldexplex.md`, existing `kavach_amm_8tier`, `kavach_router`, and the Token-2022 discussion you left off with.

---

## 1. Current state (where you left off)

### 1.1 AMMs today

| AMM            | Program              | Role                          | Token program      |
|----------------|----------------------|-------------------------------|--------------------|
| 8tier          | `kavach_amm_8tier`   | 8 fee tiers, 50/50 split      | Single (SPL or 2022 same-program) |
| Stable         | `kavach_amm_stable`  | Curve-style                  | Single             |
| CLMM           | `kavach_amm_clmm`    | Concentrated liquidity       | Single             |

- **Router:** `kavach_router` has `RouterConfig.amm_program_ids: [Pubkey; 4]`. Slot 0 = 8tier (free: rent only), 1 = stable, 2 = CLMM, 3 = Core. 8tier stays free; Core charges 0.02 SOL pool creation (frontend).
- **8tier fee tiers:** `ALLOWED_FEE_NUMERATORS` = [25, 50, 80, 100, 125, 150, 200, 250] (per 10_000) → 0.25%, 0.5%, 0.8%, 1%, 1.25%, 1.5%, 2%, 2.5%. No 0.01%, 0.05%, 0.1% or 3%, 4%.
- **Token-2022:** 8tier/stable/CLMM take one `token_program`; they already support Token-2022 when **both** mints are Token-2022 (client passes Token-2022 program). **Mixed** (A=SPL, B=Token-2022) is not supported without a second token program account.

### 1.2 Decisions from your discussion

- **Copy 8tier** into a **new program** (new crate), don’t mutate 8tier.
- **Kavach Core** = that new program: more fee tiers (Raydium-like) + optional mixed Token-2022.
- **Router:** Treat Core as a first-class AMM so the router can route through it and pass the right accounts (including optional second token program for mixed pools).

---

## 2. What “Kavach Core” should be

### 2.1 High-level

- **Name:** Kavach Core (program crate e.g. `kavach_amm_core`).
- **Base:** Copy of `kavach_amm_8tier` (constant-product, 50/50 protocol/creator, same pool state shape and instruction set).
- **Differences:**
  1. **Fee tiers:** Replace the fixed 8 tiers with a **Raydium-style tier set** (see below).
  2. **Mixed Token-2022:** Support pools where token A and token B use **different** token programs (one SPL, one Token-2022) by adding an optional second token program and using the correct program per vault/mint.

### 2.2 Fee tiers (match Raydium-style)

- Keep denominator **10_000** (basis-point style).
- **Tier set (suggested Raydium-like range):**  
  - Include low end: 1, 5, 10 (0.01%, 0.05%, 0.1%).  
  - Keep mid range similar to current 8tier: 25, 50, 80, 100, 125, 150, 200, 250.  
  - Add high end: 300, 400 (3%, 4%).

So **13 tiers** (or 16 if you add a few more intermediates):

- **13-tier:** `[1, 5, 10, 25, 50, 80, 100, 125, 150, 200, 250, 300, 400]`  
  → 0.01%, 0.05%, 0.1%, 0.25%, 0.5%, 0.8%, 1%, 1.25%, 1.5%, 2%, 2.5%, 3%, 4%.

- **16-tier (optional):** add e.g. 2, 20, 60, 175 to get more granularity.

At init, pool creator picks **one** of these; pool state still stores `fee_numerator` and `fee_denominator` (e.g. 10_000). Validation: `fee_denominator == 10_000` and `fee_numerator` in the allowed list.

### 2.3 Mixed Token-2022 design

- **Same-program pools (SPL-only or Token-2022-only):**  
  - Keep current behavior: one `token_program`; all vaults and LP mint use it. No change from 8tier.

- **Mixed pools (A = SPL, B = Token-2022):**  
  - Add a second account: `token_program_b` (optional in the instruction, or required when pool type is “mixed”).
  - **Pool state:** Add a small discriminator or flag, e.g. `token_program_b: Option<Pubkey>` (or a “pool type” enum: SameProgram vs Mixed). If Mixed, store which side is SPL and which is 2022 (e.g. `token_a_program`, `token_b_program` in state so swap/add/remove know which program to use for each vault and for LP).
  - **Initialize_pool:**  
    - If both mints same program: one `token_program`, create both vaults and LP mint with it (same as 8tier).  
    - If mixed: require `token_program` (e.g. for A) and `token_program_b` (for B). Create vault_a with token_program, vault_b with token_program_b. LP mint: choose one program (e.g. SPL for simplicity) and use that for LP mint.
  - **Swap / add_liquidity / remove_liquidity / collect_fees:**  
    - Use `token_program` for vault_a (and user token A, LP mint if LP is SPL).  
    - Use `token_program_b` for vault_b (and user token B).  
  - **Router:** When routing to Core with a mixed pool, the router must pass both token program accounts in the correct order so Core’s instruction sees them.

**Limitation (as you noted):** Token-2022 **with transfer hooks** needs extra accounts (hook program, etc.). Core does **not** plan for hooks in this phase; only “basic” Token-2022 and mixed SPL + Token-2022.

---

## 2.4 How full Token-2022 support changes the AMM

| Aspect | 8tier (current) | Core (with full Token-2022) |
|--------|-----------------|----------------------------|
| **Token program accounts** | One: `token_program`. All vaults and LP mint use it. | Same-program pools: one `token_program` (no change). Mixed pools: two accounts — `token_program` (for token A / vault A / LP if SPL), `token_program_b` (for token B / vault B). |
| **Pool state** | No token-program info; client passes program at call time. | Add `token_program_b: Option<Pubkey>` (or pool_type: SameProgram / Mixed) so swap/add/remove/collect_fees know which program to use per vault. |
| **Initialize_pool** | Creates vault_a, vault_b, lp_mint with the same program. | Same-program: unchanged. Mixed: create vault_a with token_program, vault_b with token_program_b; LP mint with one program (e.g. SPL). |
| **Swap** | One CPI to `token_program` for both transfer_in and transfer_out. | Same-program: unchanged. Mixed: transfer_in uses the program for the input vault; transfer_out uses the program for the output vault (may be different). |
| **Add/remove liquidity** | All transfers use single `token_program`. | Same-program: unchanged. Mixed: transfer token A with token_program, token B with token_program_b; LP mint with chosen program. |
| **Collect_fees** | Transfers fee tokens to protocol + creator using `token_program`. | Same-program: unchanged. Mixed: send fee_a with token_program, fee_b with token_program_b. |
| **Instruction account list** | Fixed length (e.g. 8 accounts for swap). | Same-program: same length. Mixed: +1 account (token_program_b). Router/clients pass both when pool is mixed; for same-program, can pass same program twice or Core ignores second. |

**Summary:** Full support = **two token program accounts** and **pool state that records which program per side**. Every instruction that touches vaults or user tokens branches on same-program vs mixed and uses the correct program for each vault/mint. No change to the constant-product math; only account selection and CPI targets change.

---

## 3. Router integration — Core replaces 8tier (no 4th slot)

- **Config:** Keep `RouterConfig.amm_program_ids: [Pubkey; 3]`. **Slot 0 = Kavach Core** (replaces 8tier as lead AMM), slot 1 = stable, slot 2 = CLMM.
- **InitConfig:** Client passes 3 program IDs: [Core, stable, CLMM]. When Core is deployed, re-init or update config so index 0 is Core’s program ID (not 8tier).
- **RouteAndSwap:** `amm_id == 0` invokes **Core**. Build Core’s swap instruction and pass the right accounts:
  - **Same-program** Core pools: same layout as 8tier (pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, clock).
  - **Mixed** Core pools: Core’s swap expects an extra account `token_program_b`. Router passes both token programs when the pool is mixed (e.g. from pool state flag or off-chain metadata).

### 3.2 How the router “knows” which AMM to use

- Client (or SDK) chooses `amm_id` (0 = Core, 1 = stable, 2 = CLMM) and passes the pool. For Core mixed pools, client passes both token program accounts in the fixed order.
- **Off-chain:** Indexer or API can return best AMM + pool and whether Core pool is mixed. Router stays the same; only the client/API changes.

### 3.3 Account layout for Core from the router

- **Same-program Core swap:**  
  Same as 8tier: `[pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, clock]`.
- **Mixed Core swap:**  
  Core’s swap instruction must define a fixed layout, e.g.:  
  `[pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, token_program_b, clock]`.  
  Router, when calling Core with `amm_id == 0`, always passes the same number of accounts; for same-program pools, `token_program_b` can be passed as a duplicate of `token_program` (or Core can treat “same” as “use token_program for both” if you design it that way). That keeps the router simple and account count fixed.

---

## 4. Implementation order (when you implement)

1. **New crate**  
   - Copy `programs/kavach_amm_8tier` → `programs/kavach_amm_core`.  
   - Rename program (id, crate name, any 8tier-specific comments).

2. **Fee tiers**  
   - Replace `ALLOWED_FEE_NUMERATORS` with the Raydium-style list (e.g. 13 or 16 tiers).  
   - Keep `FEE_DENOMINATOR = 10_000`.  
   - Validate at init: `fee_numerator` in allowed list, `fee_denominator == 10_000`.

3. **Mixed Token-2022 (Core only)**  
   - Extend pool state: e.g. `token_program_b: Option<Pubkey>` or `pool_type: enum { SameProgram, Mixed }` and store which program per side.  
   - Init: detect or accept “mixed” and two token program accounts; create vaults with the correct program each; choose LP mint program (e.g. SPL).  
   - Swap / add_liquidity / remove_liquidity / collect_fees: use the appropriate token program for each vault and user account.  
   - Instruction layouts: add `token_program_b` where needed (optional vs required can be decided in impl).

4. **Router**  
   - **Core replaces 8tier:** config stays `[Pubkey; 3]`. Slot 0 = Core (not 8tier), 1 = stable, 2 = CLMM. When deploying Core, set config so index 0 is Core's program ID.  
   - In RouteAndSwap: `amm_id == 0` invokes Core; build Core swap instruction and pass accounts (same-program or mixed, including `token_program_b` when mixed).

5. **Client / frontend**  
   - When creating a Core pool: choose tier from the new list; if mixed, pass both token programs.  
   - When routing: amm_id=0 = Core; pass Core program ID and the correct pool + accounts (including `token_program_b` for mixed pools).

6. **Tests**  
   - Unit tests for fee tier validation and for mixed-pool init/swap (and add/remove liquidity) with one SPL and one Token-2022 mint.

---

## 5. Summary table

| Item                         | Plan                                                                 |
|-----------------------------|----------------------------------------------------------------------|
| **New program**              | `kavach_amm_core` (copy of 8tier)                                   |
| **Fee tiers**                | Raydium-style: e.g. 13 tiers from 0.01% to 4% (denom 10_000)         |
| **Mixed Token-2022**        | Two token program accounts; per-vault/per-mint use correct program   |
| **LP mint**                 | Same-program: one program; mixed: e.g. SPL for LP                    |
| **Transfer hooks (2022)**   | Out of scope for this phase                                         |
| **Router**                   | Slot 0 = Core (replaces 8tier), 1 = stable, 2 = CLMM; config stays 3; pass both token progs when Core mixed |
| **8tier**                    | Superseded by Core; stable and CLMM unchanged; both support Token-2022 same-program only |

---

## 6. Optional: spec-only doc for handoff

If you want a short “spec only” for someone else to implement, you can add e.g. `126/DExs/Kavach/docs/AMM-EXTENDED-TIERS-TOKEN2022.md` that points to this plan and summarizes:

- Extended tiers AMM = Core; N tiers (list them), 50/50 split, same math as 8tier.
- Token support: SPL + Token-2022 same-program; mixed SPL/2022 in Core only; no hooks in v1.
- Router: slot 0 = Core (replaces 8tier); account layout for Core same-program vs mixed.

This file (`KAVACH-CORE-PLAN.md`) is the full plan; implement when ready.
