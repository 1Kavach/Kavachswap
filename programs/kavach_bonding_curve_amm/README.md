# Kavach Bonding Curve AMM — Native (no Anchor)

Pump-style bonding curve with graduation to CLMM. **Replaces 8tier** in the stack — you still have **4 AMMs:** Stable, CLMM, Core, and this Bonding Curve. **Pure Solana:** no Anchor.

## How this AMM works

- **Single-token launchpad:** One pool per token mint. Creator creates pool (free), deposits tokens into the curve, then anyone can buy (SOL → token) or sell (token → SOL).
- **Virtual reserves:** Price comes from constant-product `k = (virtual_sol + real_sol) * token_reserves`. Default 30 SOL “virtual” so there’s a starting price without liquidity.
- **Graduation:** When “real SOL raised” hits the threshold (default 69 SOL), the pool marks as graduated and can be migrated to your CLMM (no auto-migration in-program; your frontend/scripts do that).
- **Anti-snipe:** First 5 slots after pool creation, max 0.5 SOL per buy.
- **No pool-creation fee for the token creator:** Creating a bonding curve pool costs only account rent (creator pays for pool + token_vault + sol_vault accounts). No extra SOL fee to the protocol. So it stays **free for the token creator** in that sense.
- **Trading fees (on buy/sell):** Set in config (e.g. 50 bps protocol + 50 bps creator = 1% total). Total fee cap 500 bps (5%). Revenue is 50/50 protocol vs creator by default; you can tune this at init or per-pool override.

## What to charge (and keep free for creator)

- **Pool creation:** **Free for creator** — no protocol fee; creator only pays rent for the new accounts.
- **Trading (buy/sell):** Charge via config. Example: **50 bps protocol + 50 bps creator** (1% total, 50/50 split). You can do 30+30 (0.6%), 100+100 (2%), etc., up to 500 bps total. So you earn from volume, not from creators creating pools.

## Features

- **Virtual CPMM:** `k = (virtual_sol + real_sol) * token_reserves`; default 30 SOL virtual, 69 SOL graduation.
- **50/50 fee split:** Protocol + creator (configurable bps, cap 500 total).
- **Anti-snipe:** Max 0.5 SOL per buy in the first 5 slots after pool creation.
- **Token-2022:** Uses `transfer_checked` and `is_token_2022` pool flag; pass the correct token program.
- **Events:** `bonding_curve_created`, `buy`, `sell`, `graduation` via `sol_log_data` for indexers.

## Instructions (discriminator byte)

| Disc | Name | Accounts |
|------|------|----------|
| 0 | InitializeConfig | config (PDA), admin, protocol_treasury, clmm_program, system_program, rent |
| 1 | CreatePool | config, mint, pool, token_vault, sol_vault, creator, system_program, token_program, rent, clock |
| 2 | DepositTokens | pool, mint, token_vault, creator_token_account, creator, token_program |
| 3 | Buy | pool, config, mint, token_vault, sol_vault, user_token_account, user, protocol_treasury, creator, system_program, token_program, clock |
| 4 | Sell | (same as Buy) |
| 5 | SetPaused | config, admin |
| 6 | UpdateClmmProgram | config, admin |

## PDAs

- **Config:** `["bc_config"]`
- **Pool:** `["pool", mint]`
- **Token vault:** created by client (SPL account, authority = pool PDA)
- **SOL vault:** `["sol_vault", mint]` (program-owned, 0 bytes, holds lamports)

## Build

```bash
cargo build-sbf
# or
cargo build --release
```

## Usage with Kavach stack

- **4 AMMs:** Use this as the replacement for 8tier: router slots = [Stable, CLMM, Core, **BondingCurve**].
- Deploy alongside `kavach_router` and the other AMMs. Use this program for launchpad flows: create pool (free for creator) → buy/sell → graduate to CLMM.
