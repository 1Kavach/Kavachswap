# Kavach Protocol

React + Vite DEX frontend: Swap (Jupiter), Token Factory (SPL + protocol fee), Liquidity (Raydium). Protocol-first: get this online, then launch KVH.

## Setup

```bash
npm install
npm run dev
```

Set `VITE_SOLANA_RPC` in `.env` if needed (default: devnet).

## Before going live

1. **Protocol treasury** — In `src/lib/constants.ts` set **`PROTOCOL_TREASURY`** to your wallet pubkey (receives token-creation fee and later AMM protocol share). Leave empty for no creation fee.
2. **Token creation fee** — `TOKEN_CREATION_FEE_LAMPORTS` (e.g. `16_000_000` = 0.016 SOL). You earn this when users create tokens via Token Factory.
3. **KVH** — `KAVACH_MINT` is set to your KVH mint. Launch KVH (Raydium pool) only after the protocol site is live.

## Build & deploy

```bash
npm run build
```

Deploy the `dist/` folder to Vercel, Netlify, or any static host. Protocol is “online” when the site is live at your URL.

## On-chain program — verified builds

The Core AMM crate lives under `programs/kavach_amm_core/`; the repo root is a **Cargo workspace** with a committed `Cargo.lock` for reproducible builds. See **`VERIFY-BUILDS.md`** for `solana-verify` and mainnet program ID `9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`.

## Features

- **Swap** — Jupiter (no custom AMM required).
- **Token Factory** — Create SPL token; optional protocol fee (SOL) to `PROTOCOL_TREASURY`.
- **Liquidity / Pools** — Links to Raydium; add your own AMM later (see 224.txt / soldexplex.md).

See `126/files/MIGRATION-PLAN-KAVACH.md` and `126/files/soldexplex.md` for full plan and protocol-first checklist.
