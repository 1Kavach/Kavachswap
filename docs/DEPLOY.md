# Kavach program deploy

## Router program ID (for interaction)

- **Program ID:** `611Zw3DdKegJN3F3BJ6F9nGsCngTMMSsKzWdFdwSKEpR`
- **Keypair (for deploy/upgrade):** `programs/kavach_router/target/deploy/kavach_router-keypair.json` — **keep this file**; you need it to deploy and upgrade the router. Do not commit it to public repos.
- **Frontend:** `KAVACH_ROUTER_PROGRAM_ID` is set in `src/lib/constants.ts` so the app can build router instructions.

You cannot interact with the router on-chain until it is **deployed**. After deploy, call **InitConfig** (authority + 4 AMM program IDs), then the frontend or scripts can call RouteAndSwap / RouteAndSwapMultiHop.

## Deployer keypair

- **File:** `c:\126\files\wallet_gold.json`
- **Role:** Signer for `solana program deploy`; by default this keypair becomes **upgrade authority** for each deployed program.
- **Security:** Keep the file private; anyone with it can deploy and upgrade programs.

## Commands

**Deployer public key (upgrade authority address):**
```bash
solana address -k c:\126\files\wallet_gold.json
```

**Deploy the router (devnet example, with fixed program ID):**
```bash
solana config set --url devnet
cd c:\126\DExs\Kavach\programs\kavach_router
solana program deploy target/deploy/kavach_router.so --keypair c:\126\files\wallet_gold.json --program-id target/deploy/kavach_router-keypair.json
```
Using `--program-id target/deploy/kavach_router-keypair.json` makes the deployed program’s address equal to `KAVACH_ROUTER_PROGRAM_ID` (611Z...). Same pattern for other programs: use each program’s keypair in its own `target/deploy/` for a stable ID.

**Using this keypair for scripts (e.g. deploy-kvh.ts):**
Set `ANCHOR_WALLET=c:\126\files\wallet_gold.json` so scripts use the same deployer.
