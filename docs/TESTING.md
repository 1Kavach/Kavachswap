# Where and how to test (Kavach)

## Token: `AJkyUCFTRD8113aFeaJxTvLKHAEtsheb6jAXLmsx2sh7`

This mint is **KVH** (Kavach coin). It’s already set in the frontend:

- **File:** `src/lib/constants.ts`
- **Constant:** `KAVACH_MINT = "AJkyUCFTRD8113aFeaJxTvLKHAEtsheb6jAXLmsx2sh7"`
- **Usage:** Swap/pool pairs (e.g. KVH/SOL), display name “KVH”, decimals 6 in `TOKEN_DECIMALS`.

If you deployed KVH with `scripts/deploy-kvh.ts`, the script writes the new mint to `deployment-info.json` and tells you to copy `tokens.KVH.mint` into `KAVACH_MINT`. If this address is from that deploy (or you created it elsewhere), the frontend is already pointing at it.

---

## 1. Frontend (swap, token factory, liquidity)

**Where:** In the repo root: `npm run dev` (default RPC = devnet).

**How:**

1. Set `VITE_SOLANA_RPC` in `.env` if you want a different RPC (default: devnet).
2. `npm install` then `npm run dev`.
3. Connect a devnet wallet (with devnet SOL and, for swap/pools, devnet tokens).
4. Test:
   - **Swap** — Jupiter (no custom AMM); use KVH/SOL or other pairs Jupiter has on devnet.
   - **Token Factory** — Create SPL token; fee goes to `PROTOCOL_TREASURY` if set.
   - **Liquidity / Pools** — Raydium links; your own AMM pools appear here only after you wire the UI to your deployed AMM(s) and router.

**Token:** KVH is used wherever the UI shows “KVH” or uses `KAVACH_MINT` / `KNOWN_MINTS.KVH`.

---

## 2. Programs (router, Core, 8tier, stable, CLMM)

**Where:** Programs live under `programs/`: `kavach_router`, `kavach_amm_core`, `kavach_amm_8tier`, `kavach_amm_stable`, `kavach_amm_clmm`.

### `kavach_amm_core` — `cargo test`

There are **no** `#[test]` modules under `programs/kavach_amm_core/src/`. The crate intentionally dropped `solana-program-test` from dev-dependencies (see `Cargo.toml` comment). Running:

```bash
cd programs/kavach_amm_core
cargo test
```

will complete but **does not run AMM instruction tests** — only dependency tests if any. On-chain behavior is validated by **devnet/mainnet integration** (frontend `ammCore.ts`, or a script you add under `scripts/`), not by in-crate BPF tests today.

The file `126/files/full-so.txt` may contain pasted snippets from **other** programs (e.g. KVUSD); it is **not** the live test suite for Core AMM.

### Core AMM — E2E / integration suite (separate crate)

**Where:** `e2e/kavach_amm_core_suite/` (inside this Kavach repo, **not** under `programs/kavach_amm_core`, so the program crate stays free of `solana-program-test`).

1. Build BPF: `cd programs/kavach_amm_core && cargo build-sbf`
2. **Rust:** `cd e2e/kavach_amm_core_suite && cargo test`  
   - Uses default `.so` path `../../programs/kavach_amm_core/target/deploy/kavach_amm_core.so` or `KAVACH_SO_PATH`.
3. **JS (Mocha):** `cd e2e/kavach_amm_core_suite && npm install && npm run test:devnet`  
   - Or from Kavach root: `npm run test:amm-e2e`

See `e2e/kavach_amm_core_suite/README.md` for details. Align JS tests with `src/lib/ammCore.ts` before relying on them for devnet.

**Build / check:**

```bash
cd programs/kavach_router
cargo check
# or build for deploy:
cargo build-sbf
```

Same for `programs/kavach_amm_core` (and others). Use `cargo build-sbf` when you’re ready to deploy.

**Deploy (devnet) — preferred path for AMM checks**

Use **devnet** (or mainnet) for real integration tests. Local `solana-test-validator` is optional; see `LOCAL-VALIDATOR.md` only if you need an offline loop.

1. Configure CLI: `solana config set --url devnet`
2. Get devnet SOL: `solana airdrop 2` (or use a faucet).
3. Build then deploy, e.g.:
   ```bash
   cd programs/kavach_amm_core
   cargo build-sbf
   solana program deploy target/deploy/kavach_amm_core.so --program-id target/deploy/kavach_amm_core-keypair.json --url devnet
   ```
4. Point the app at devnet: set `VITE_SOLANA_RPC` to a devnet endpoint and `KAVACH_AMM_CORE_PROGRAM_ID` in `src/lib/constants.ts` if your devnet program ID differs from mainnet.
5. After deploy, verify embedded metadata: `query-security-txt target/deploy/kavach_amm_core.so` (see `programs/kavach_amm_core/SECURITY-CHECKLIST.md`).

**Testing the router / AMMs:**

- **On-chain:** After deploy, you need a **client** that builds the right instructions and sends transactions:
  1. **InitConfig** — once per router: accounts = config (PDA), payer, system_program, rent; data = 4 AMM program IDs (Borsh).
  2. **RouteAndSwap** — 11 accounts (config, user, amm_program, pool, vault_in, vault_out, user_token_in, user_token_out, token_program_a, token_program_b, clock); data = Borsh(amount_in, minimum_amount_out, amm_id, a_to_b).
- **Options:**
  - **TypeScript script** in `scripts/` (e.g. `scripts/test-router.ts`) that uses `@solana/web3.js` and `@solana/spl-token` to build and send InitConfig and RouteAndSwap. Run with `npx ts-node scripts/test-router.ts` (or similar).
  - **Frontend** — Add a “Swap via router” flow that builds the same instruction and submits the tx (needs deployed program IDs and pool/vault addresses).
- There are no in-crate unit tests for the router today; `cargo test` in the router will only run dependency tests. Integration testing is “deploy + script or UI”.

---

## 3. Anchor (vault)

**Where:** `anchor/` — separate Anchor workspace (vault program).

**How:**

```bash
cd anchor
anchor test --skip-deploy   # unit / lite-svm tests
anchor deploy --provider.cluster devnet
```

See `anchor/README.md` for details.

---

## Quick reference

| What to test        | Where              | How                                      |
|---------------------|--------------------|------------------------------------------|
| Swap, Token Factory | Frontend           | `npm run dev`, devnet, connect wallet     |
| KVH token           | `src/lib/constants.ts` | Already set as `KAVACH_MINT` (AJky...7) |
| Router / AMMs       | Programs           | `cargo check` / `cargo build-sbf`, then deploy + script or UI |
| Vault               | `anchor/`           | `anchor test`, `anchor deploy --provider.cluster devnet` |

To actually **execute** a router swap you need: router and one AMM deployed, a pool and vaults created on that AMM, and a script or frontend that builds the 11-account RouteAndSwap and submits the transaction.
