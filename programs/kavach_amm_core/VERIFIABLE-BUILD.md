# Update & deploy guide — Kavach Core AMM

**Role:** Senior protocol integration engineer / enterprise-grade Solana developer. This guide is the single source for how to test, build, and deploy the Core AMM without breaking production state.

---

## Don’t erase

- **Do not delete or overwrite:** program keypairs (`*-keypair.json`), program IDs in constants, or this guide. Add to docs; do not remove existing deployment info.
- **Do not replace** `KAVACH_AMM_CORE_PROGRAM_ID` or router program ID in the frontend with a new address unless you are intentionally deploying a new program (not an upgrade).
- **Upgrades:** Deploying a new `.so` with the same `--program-id` is an upgrade; the program ID stays the same. Keep the same keypair for that program.
- Preserve `kvh.txt`, `soldexplex.md`, and any deployment signatures/addresses you use for audit or recovery.

---

## Test first, then build, then update

Always run checks and E2E against the **current** deployment before building a new binary or upgrading. That way you confirm the pipeline and catch integration issues before touching the chain.

### 1. E2E before `cargo build` (no new .so yet)

You can run end-to-end flows **without** building a new program. Use the program **already deployed** on your target cluster (mainnet or devnet).

- **Purpose:** Validate frontend, RPC, wallet, constants, and existing program behavior. If something is wrong (wrong program ID, RPC, missing pool), you find it before building.
- **How:**
  1. Point the app at the cluster where Core is already deployed (e.g. mainnet or devnet): set `VITE_SOLANA_RPC` in `.env`.
  2. Ensure `KAVACH_AMM_CORE_PROGRAM_ID` (and router ID if you use it) in `src/lib/constants.ts` match the **deployed** program IDs.
  3. Run the frontend: `cd c:\126\DExs\Kavach` then `npm run dev`. Connect wallet, open Swap / Liquidity / Pools / Token Factory.
  4. Execute the flows you care about: create token, open/create pool, add liquidity, swap (Jupiter or your AMM if wired). Confirm txs succeed and state looks correct.
- **Outcome:** If E2E passes, your config and current deployment are consistent. You can proceed to build. If it fails, fix config or deployment before building.

### 2. Pre-build checks (still no new .so)

- From the Core AMM crate:  
  `cd c:\126\DExs\Kavach\programs\kavach_amm_core`  
  Run:  
  `cargo check`  
  Fix any errors. Optionally run `cargo test` if you add unit tests.
- Ensures the code compiles and any tests pass before a long or fragile `cargo build-sbf` (or verifiable build).

### 3. Build

- **Option A — Verifiable build (recommended for public trust):**  
  `solana-verify build`  
  (from `programs/kavach_amm_core`; requires Docker and `cargo install solana-verify`).
- **Option B — Standard build:**  
  `cargo build-sbf`  
  (from `programs/kavach_amm_core`).  
  Note: If you hit sBPF stack overflow with Token-2022/zk-ops, use an existing `.so` for deploy or temporarily remove Token-2022 per `soldexplex.md` until the toolchain is fixed.
- Output: `target/deploy/kavach_amm_core.so` (and keypair at `target/deploy/kavach_amm_core-keypair.json`).

### 4. Deploy to a non-mainnet cluster first (recommended)

- Configure CLI for devnet or local validator:  
  `solana config set --url devnet` (or `http://127.0.0.1:8899` for local).
- Deploy the **same** program ID (upgrade path):  
  `solana program deploy target/deploy/kavach_amm_core.so --program-id target/deploy/kavach_amm_core-keypair.json`
- Run E2E again on this cluster (same steps as §1). Confirm create pool, add liquidity, swap.
- If everything passes, proceed to mainnet upgrade. If not, fix and repeat; do not upgrade mainnet until devnet/local E2E is green.

### 5. Mainnet upgrade (only after E2E passes elsewhere)

- Set RPC:  
  `solana config set --url "https://api.mainnet-beta.solana.com"`  
  (or your mainnet RPC).
- Deploy (upgrade):  
  `solana program deploy target/deploy/kavach_amm_core.so --program-id target/deploy/kavach_amm_core-keypair.json`  
  Program ID remains: `9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`.
- After deploy, run E2E once more on mainnet if you have a test pool and wallet; confirm swap/pool flows.

---

## Verifiable build (Solana Foundation)

So users can verify that the deployed program matches your public source. See [solana-verifiable-build](https://github.com/solana-foundation/solana-verifiable-build) and [Solana docs: Verified builds](https://solana.com/developers/guides/advanced/verified-builds).

### Prerequisites

- Docker  
- Cargo + Solana CLI  
- **Solana Verify CLI:** `cargo install solana-verify`

### Steps

1. **Deterministic build** (from this directory):  
   `cd c:\126\DExs\Kavach\programs\kavach_amm_core`  
   `solana-verify build`  
   Produces a reproducible `.so` and build metadata.

2. **Deploy** (as in §4–5 above):  
   Use the same program ID and keypair; deploy to devnet/local first, then mainnet after E2E.

3. **Verify from repo** (upload build data on-chain; replace `YOUR_ORG/YOUR_REPO` with your GitHub repo path):  
   `solana-verify verify-from-repo -u https://api.mainnet-beta.solana.com --program-id 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM https://github.com/YOUR_ORG/YOUR_REPO`

4. **Trigger remote verification job:**  
   `solana-verify remote submit-job --program-id 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM --uploader H8t886PgU6XKSV5DJPehqggVwJwHBCnBMkGKGcUzqhXj`  
   `--uploader` is the pubkey that ran `verify-from-repo` (e.g. wallet_0).

### Notes

- Source must be **public** on GitHub for `verify-from-repo`.
- Verified builds prove **reproducibility** (same source → same binary); they do not replace audits or security.txt.

---

## Summary order

1. **E2E** against current deployment (no build) → fix config if needed.  
2. **cargo check** (and **cargo test** if present) in `programs/kavach_amm_core`.  
3. **Build:** `solana-verify build` or `cargo build-sbf`.  
4. **Deploy** to devnet/local → **E2E** again.  
5. **Deploy** to mainnet (upgrade) only after step 4 passes.  
6. **Verifiable build:** after deploy, run `verify-from-repo` and `remote submit-job` if you use public GitHub.

Throughout: **don’t erase** program IDs, keypairs, or deployment records; **test first**; keep this guide and related docs in a professional, consistent state.
