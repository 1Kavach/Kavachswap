# Verified builds (Kavach AMM Core)

This repo has a **Rust workspace** at the root (`Cargo.toml` + `Cargo.lock`) with `programs/kavach_amm_core` as a member so third parties (and [Solana verified builds](https://solana.com/docs/programs/verified-builds)) can reproduce the same `.so` hash as mainnet.

**CLI:** [`solana-foundation/solana-verifiable-build`](https://github.com/solana-foundation/solana-verifiable-build) — install with `cargo install solana-verify` (see upstream README for pinned versions).

## Local deterministic build (Docker)

From the **repository root** (same folder as this file):

```bash
solana-verify build --library-name kavach_amm_core
```

The library name is the crate/lib name `kavach_amm_core` (see `programs/kavach_amm_core/Cargo.toml`).

## Compare hash to on-chain program

```bash
solana-verify get-executable-hash target/deploy/kavach_amm_core.so
solana-verify get-program-hash -u https://api.mainnet-beta.solana.com 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM
```

Use a paid RPC URL if the public endpoint rate-limits you.

## Verify from GitHub (after you push)

Replace `<COMMIT>` with the **exact** commit you built and deployed from.

```bash
solana-verify verify-from-repo \
  --url https://api.mainnet-beta.solana.com \
  --program-id 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM \
  --library-name kavach_amm_core \
  --commit-hash <COMMIT> \
  --mount-path . \
  https://github.com/1Kavach/Kavachswap.git
```

If the tool insists on the package subfolder only, try `--mount-path programs/kavach_amm_core` instead of `--mount-path .` (depends on CLI version).

Upload verification metadata when prompted (upgrade authority), then use remote verification as described in the official docs:

```bash
solana-verify remote submit-job \
  --program-id 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM \
  --uploader <UPGRADE_AUTHORITY_PUBKEY>
```

For **Squads** / multisig upgrade authority, export the PDA transaction and execute it through the multisig, then run `remote submit-job` — see [Verified builds — multisig](https://solana.com/docs/programs/verified-builds).

## security.txt

Core embeds contacts via `solana-security-txt` in `programs/kavach_amm_core`. Validate locally with `query-security-txt` if installed.
