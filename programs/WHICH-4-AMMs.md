# Which 4 AMMs — deploy list (8tier not deployed)

Per **126/files/soldexplex.md** table (“Programs (4 AMMs + Router)”): **set order** is:

- **Slot 0** = Bonding Curve  
- **Slot 1** = Stable  
- **Slot 2** = CLMM  
- **Slot 3** = Core  

InitConfig: `amm_program_ids = [BC, Stable, CLMM, Core]`. For testing with only Core deployed you can use `[placeholder, placeholder, placeholder, Core]` (Core in slot 3).

## What’s in `programs/`

| Folder | Deploy? | Note |
|--------|--------|------|
| **kavach_router** | Yes | Router; deploy first. |
| **kavach_bonding_curve_amm** | Yes | **Slot 0** (per guide table). |
| **kavach_amm_stable** | Yes | Slot 1. |
| **kavach_amm_clmm** | Yes | Slot 2. |
| **kavach_amm_core** | Yes | **Slot 3** (Token-2022, 9 accounts). |
| **kavach_amm_8tier** | **No** | Leave in repo for later. Not deployed = no extra cost. |
| **kavach_amm** | **No** | Legacy/reference. Not deployed unless you decide to. |

## The 4 AMMs — slot order (from soldexplex.md table)

- **Slot 0:** Bonding Curve  
- **Slot 1:** Stable  
- **Slot 2:** CLMM  
- **Slot 3:** Core  

When you call **InitConfig**, pass the 4 program IDs in that order: `[BC_program_id, Stable_program_id, CLMM_program_id, Core_program_id]`. 8tier is not in the list.

## 8tier

- **Stays in the folder** — no delete. Safe for later.
- **Not deployed** — you never run `solana program deploy` on it, so no extra SOL.
- **Not in the way** — the router only uses the 4 program IDs you give it at init. 8tier doesn’t run unless you deploy it and add it to the config.

Nothing here is deleted; only the 4 AMMs above + router get built/deployed when you’re ready.
