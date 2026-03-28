# Kavach Core AMM — E2E & integration tests

**Location:** `Kavach/e2e/kavach_amm_core_suite/` (next to `programs/kavach_amm_core`).

Program ID: `9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`

This crate stays **outside** `programs/kavach_amm_core` so the on-chain program does not pull `solana-program-test` / `solana-sdk` as dev-deps (those were removed from the program `Cargo.toml` on purpose).

## Build the `.so` first

```bash
cd programs/kavach_amm_core
cargo build-sbf
```

Default path used by tests: `programs/kavach_amm_core/target/deploy/kavach_amm_core.so`

Override: `KAVACH_SO_PATH` (Rust) or `KAVACH_SO_PATH` (JS).

## Rust (`solana-program-test`)

From this directory:

```bash
cd e2e/kavach_amm_core_suite
cargo test
```

- Math / encoding tests always run.
- **B1** (load BPF + `InitializePool`) runs only if the `.so` exists at the default path or `KAVACH_SO_PATH`.

## JS / Mocha (devnet)

```bash
cd e2e/kavach_amm_core_suite
npm install
npm run test:devnet
```

Or from Kavach repo root: `npm run test:amm-e2e` (see root `package.json`).

**Note:** The JS file is a **legacy / aspirational** harness; instruction layouts and account lists must match `src/lib/ammCore.ts` and the on-chain program. Prefer the Rust suite + manual UI testing until the JS harness is aligned.

## Security script

`security_verify.sh` documents `query-security-txt` and `solana-verify` steps. Run from Git Bash/WSL, or follow the same commands in PowerShell.

## Old path

If you still have `DExs/suitecore/`, it is deprecated — use this folder only.
