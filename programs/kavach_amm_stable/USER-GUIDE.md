# How users use the Kavach Stable Pool

## Audience
LPs and swappers for **stable/pegged pairs** (e.g. USDC/USDT, USDC/USDq) who want low slippage and a low fee (e.g. 0.04%) instead of the Core AMM’s 0.3%.

---

## 1. Pool creation (one-time)

**Who:** Protocol or pool creator.

**Instruction:** `initialize_pool` (discriminator `0`).

**Accounts (in order):**  
`pool` (PDA: `["pool", token_a_mint, token_b_mint]`), `token_a_mint`, `token_b_mint`, `token_a_vault`, `token_b_vault`, `lp_mint`, `protocol_fee_recipient`, `creator_fee_recipient`, `payer`, `system_program`, `token_program`, `rent`.

**Instruction data (Borsh):**  
`amp_factor` (u64, e.g. 100–10000), `swap_fee_bps` (u64, e.g. 4 = 0.04%, max 1000 = 10%), `protocol_fee_bps`, `creator_fee_bps` (must sum to 10_000, e.g. 5000/5000 for 50/50 split of the swap fee).

**Steps:**  
Payer creates the pool account (PDA), two vault token accounts, and the LP mint (authority = pool PDA), then the program writes pool state (including `amp_factor` and fee). Token A mint must be less than token B mint (canonical order).

---

## 2. Add liquidity (LPs)

**Who:** Liquidity providers.

**Instruction:** `add_liquidity` (discriminator `2`).

**Accounts:**  
`pool`, `token_a_vault`, `token_b_vault`, `lp_mint`, `user_token_a`, `user_token_b`, `user_lp_token`, `user` (signer), `token_program`, `clock`.

**Instruction data:**  
`amount_a`, `amount_b`, `min_lp_tokens` (slippage).

**Steps:**  
User sends token A and token B to the vaults; receives LP tokens (proportional to existing supply or sqrt(a*b) for first deposit). Frontend should compute expected LP and set `min_lp_tokens` accordingly.

---

## 3. Swap (traders)

**Who:** Swappers.

**Instruction:** `swap` (discriminator `1`).

**Accounts:**  
`pool`, `vault_in`, `vault_out`, `user_token_in`, `user_token_out`, `user` (signer), `token_program`, `clock`.

**Instruction data:**  
`amount_in`, `minimum_amount_out` (slippage), `a_to_b` (true = token A → token B).

**Steps:**  
User sends `amount_in` of input token to the pool’s vault and receives output token from the other vault. Output is computed with the **stable curve** (amplification + D invariant). Fee is taken from input (e.g. 0.04%); fees accumulate in pool state for `collect_fees`. Frontend/router should simulate or quote and set `minimum_amount_out`.

---

## 4. Remove liquidity (LPs)

**Who:** LPs.

**Instruction:** `remove_liquidity` (discriminator `3`).

**Accounts:**  
`pool`, `token_a_vault`, `token_b_vault`, `lp_mint`, `user_token_a`, `user_token_b`, `user_lp_token`, `user` (signer), `token_program`, `clock`.

**Instruction data:**  
`lp_tokens`, `min_amount_a`, `min_amount_b` (slippage).

**Steps:**  
User burns `lp_tokens` and receives proportional token A and token B from the vaults.

---

## 5. Collect fees (protocol / creator)

**Who:** Protocol and pool creator (or keeper).

**Instruction:** `collect_fees` (discriminator `4`).

**Accounts:**  
`pool`, `token_a_vault`, `token_b_vault`, `protocol_ata_a`, `creator_ata_a`, `protocol_ata_b`, `creator_ata_b`, `token_program`.

**Steps:**  
Transfers accumulated `total_fees_a` and `total_fees_b` from the vaults to protocol and creator ATAs (50/50 per token). Resets pool’s `total_fees_*` to zero.

---

## Frontend / router

- **Stable pairs:** Use this program (stable pool) for pairs like USDC/USDT; use Core AMM (or 8-tier) for volatile pairs.
- **Quoting:** Implement the same stable math (`calculate_stable_swap_output`) off-chain to show expected amount out and set `minimum_amount_out`.
- **Account resolution:** Resolve pool PDA, vaults, and LP mint from token mints (and program ID). Ensure vaults and LP mint match the pool’s stored pubkeys.
