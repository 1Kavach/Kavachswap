# Kavach AMM Core

Native Solana program: constant-product style pools with multiple fee tiers, Token-2022–aware swaps, and a fixed protocol/creator fee split. The live app and instruction helpers live in the parent [Kavach package](../../).

## Build (from this folder)

```bash
cargo check          # fast compile check
cargo build-sbf      # release .so under target/deploy/ (used for deploy)
```

Use a Solana CLI + `cargo-build-sbf` toolchain that matches your deployment environment. Do not commit the `target/` directory; it stays local or in CI.

## Source & verification

Keep **`Cargo.lock`** committed so dependency versions stay reproducible. For **verifiable builds**, the same commit you deploy should be what tools like `solana-verify` rebuild from public Git — bytecode is not checked in here.

## Need help?

See the main Kavach docs or site; this crate is the on-chain piece only (no Anchor).
