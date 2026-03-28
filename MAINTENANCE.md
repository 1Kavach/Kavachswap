# Kavach Core AMM — maintenance & mainnet upgrade

Program ID (mainnet): **`9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`**  
Program keypair (do not rotate id on upgrade): `programs/kavach_amm_core/target/deploy/kavach_amm_core-keypair.json`  
Upgrade authority: the wallet that signs `solana program deploy` (must match on-chain program upgrade authority).

Replace placeholders:

- `YOUR_MAINNET_RPC` — e.g. Helius or Chainstack URL from `126/files/4.txt` / `315.txt` (avoid public `api.mainnet-beta.solana.com` for production deploys).
- `PATH_TO_UPGRADE_AUTHORITY.json` — JSON keypair file for the upgrade authority (e.g. `c:\126\files\wallet_0.json`).

Paths below assume repo root: `c:\126\DExs\Kavach` (adjust if yours differ).

---

## 1. Point CLI at mainnet + upgrade wallet

```powershell
solana config set --url YOUR_MAINNET_RPC
solana config set --keypair PATH_TO_UPGRADE_AUTHORITY.json
solana balance
```

---

## 2. Build the on-chain program

```powershell
cd c:\126\DExs\Kavach\programs\kavach_amm_core
cargo check
cargo build-sbf
```

Artifact: `target\deploy\kavach_amm_core.so`

---

## 3. Check embedded `security.txt` (optional but recommended)

```powershell
# once: cargo install query-security-txt
query-security-txt c:\126\DExs\Kavach\programs\kavach_amm_core\target\deploy\kavach_amm_core.so
```

---

## 4. Run Rust integration tests (same repo)

From Kavach root:

```powershell
cd c:\126\DExs\Kavach
cargo test --manifest-path e2e\kavach_amm_core_suite\Cargo.toml
```

Optional: point tests at a specific `.so`:

```powershell
$env:KAVACH_SO_PATH = "c:\126\DExs\Kavach\programs\kavach_amm_core\target\deploy\kavach_amm_core.so"
cargo test --manifest-path c:\126\DExs\Kavach\e2e\kavach_amm_core_suite\Cargo.toml
```

---

## 5. Upgrade program on mainnet (same program id)

```powershell
cd c:\126\DExs\Kavach\programs\kavach_amm_core
solana program deploy target\deploy\kavach_amm_core.so `
  --program-id target\deploy\kavach_amm_core-keypair.json `
  --url YOUR_MAINNET_RPC
```

This **replaces** live bytecode for that address; pool accounts and PDAs are unchanged.

---

## 6. Confirm on-chain

```powershell
solana program show 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM --url YOUR_MAINNET_RPC
```

Check **ProgramData**, **authority**, and that **last deploy slot** moved.

Explorer: [Solana Explorer — Core AMM](https://explorer.solana.com/address/9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM)

---

## 7. Optional — verifiable build (public trust)

Requires a **public git repo** with the **exact commit** you built (e.g. [1Kavach/Kavachswap](https://github.com/1Kavach/Kavachswap.git)).

```powershell
# cargo install solana-verify   # once; Docker used for reproducible build
cd c:\126\DExs\Kavach\programs\kavach_amm_core
solana-verify build
# Then follow: https://github.com/solana-foundation/solana-verifiable-build
# verify-from-repo + remote submit against your commit
```

Verifiable build does **not** block deploy; run after upgrade when the repo and tooling are ready.

---

## 8. Optional — JS e2e against devnet

```powershell
cd c:\126\DExs\Kavach
npm run test:amm-e2e
```

Use for extra confidence; Rust e2e in step 4 is the primary gate many teams use before mainnet.

---

## 9. Frontend (Cloudflare) — when needed

Upgrade the **program** when bytecode changes. Redeploy **Cloudflare** (`npm run build`, publish `dist/`) when the **website** or **`VITE_*` env** (RPC, copy, client fixes) changes. They are independent unless you change program id or client instructions.

---

## Short order (checklist)

1. `solana config` → mainnet RPC + upgrade keypair → `solana balance`  
2. `cargo build-sbf` in `programs/kavach_amm_core`  
3. `query-security-txt` on `target/deploy/kavach_amm_core.so`  
4. `cargo test --manifest-path e2e/kavach_amm_core_suite/Cargo.toml`  
5. `solana program deploy … --program-id … --url YOUR_MAINNET_RPC`  
6. `solana program show 9SYz…`  
7. (Later) `solana-verify` + `verify-from-repo` when GitHub matches the build  
8. (Optional) `npm run test:amm-e2e` on devnet  
9. Cloudflare only if the frontend/env changed  

---

## Related docs

- Dev harness log: `126/files/testr.txt`  
- RPC order / keys (do not commit secrets): `126/files/315.txt`, `126/files/4.txt`  
- Protocol status / stack notes: `126/files/soldexplex.md`
