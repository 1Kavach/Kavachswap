# Build checklist — clean cache, Solana 1.18, then build

---

## What actually worked (Windows, Mar 2026) — router built

**Result:** `kavach_router.so` was produced at `programs/kavach_router/target/deploy/kavach_router.so`.

**What we did:**

1. **Agave CLI 3.1.8** — Installed via `agave-install.exe 3.1.8` (from [Agave releases](https://github.com/anza-xyz/agave/releases)). After install, restart terminal; `solana --version` must show **3.1.8 (client:Agave)**, not 1.18.26 SolanaLabs.
2. **HOME on Windows** — Before building, run `$env:HOME = $env:USERPROFILE` so `cargo-build-sbf` can find the home directory.
3. **Router `Cargo.toml`** — Optional patch for `wit-bindgen-rust-macro` (avoids edition2024 issues if the resolver pulls 0.51):
   ```toml
   [patch.crates-io]
   wit-bindgen-rust-macro = { git = "https://github.com/bytecodealliance/wit-bindgen", tag = "v0.50.0" }
   ```
   Cargo may report "Patch ... was not used in the crate graph" — that’s fine; build can still succeed.
4. **No `rust-toolchain.toml`** — Removed so Agave’s bundled Cargo is used (no Rust 1.75 pin).
5. **Build command** (in `programs/kavach_router`):
   ```powershell
   cargo build-sbf --force-tools-install
   ```
   First run can take ~1–2 minutes (downloads + compile). Success = `Finished release profile` and `target/deploy/kavach_router.so` exists.

**Next:** Build the 4 AMMs the same way (each in its own folder). Then deploy with test SOL on devnet when ready.

---

## 1. Clean Solana toolchain cache (fresh chance)

On Windows the cache is under your user folder. In PowerShell run:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\solana" -ErrorAction SilentlyContinue
```

That deletes the cached platform-tools and any corrupted Solana toolchain data. No need to touch `wallet_gold.json` or any other JSON — that’s only for deploy.

## 2. Install Solana 1.18

```powershell
solana-install init 1.18
```

If `solana-install` is not found, install the Solana CLI for 1.18 from https://github.com/solana-labs/solana/releases then run the same command. Close and reopen the terminal after install so PATH is updated.

## 3. Build (produces .so — devnet vs mainnet doesn’t matter)

Build is **local only**. It always produces the same `.so` file. Devnet vs mainnet only matters when you **deploy** (which RPC you point at). So: yes, even for devnet you get a real `.so` file from build.

From the Kavach repo:

```powershell
cd c:\126\DExs\Kavach\programs\kavach_router
cargo build-sbf --force-tools-install
```

First run may download platform-tools (can take a few minutes). On success you get:

`kavach_router\target\deploy\kavach_router.so`

Then build the 4 AMMs (same way, no deploy yet):

```powershell
cd ..\kavach_bonding_curve_amm
cargo build-sbf --force-tools-install

cd ..\kavach_amm_stable
cargo build-sbf --force-tools-install

cd ..\kavach_amm_clmm
cargo build-sbf --force-tools-install

cd ..\kavach_amm_core
cargo build-sbf --force-tools-install
```

## 4. What’s already verified (no stone unturned)

- **Router:** Cargo.toml uses solana-program 1.18, no extra features. lib.rs has standard entrypoint. Slot order in code: 0=BC, 1=Stable, 2=CLMM, 3=Core; Core uses 9 accounts for amm_id 3.
- **AMMs:** All use solana-program 1.18 and spl-token 4.0. No Anchor. Build order doesn’t depend on devnet/mainnet.
- **Token creator:** Not a separate program. Token creation is in the **frontend** (Create Token tab + `src/lib/token.ts`) and uses SPL + constants (`TOKEN_CREATION_FEE_LAMPORTS`, `PROTOCOL_TREASURY`). You do **not** need to build a “token creator” program for the router + 4 AMMs. Set `PROTOCOL_TREASURY` in `src/lib/constants.ts` when you want fees to go somewhere.

## 5. Summary

| Step | Action |
|------|--------|
| Cache | `Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\solana" -ErrorAction SilentlyContinue` |
| Toolchain | `solana-install init 1.18` (then reopen terminal) |
| Build | `cargo build-sbf --force-tools-install` in router, then each AMM |
| Token creator | No extra program; it’s frontend + constants. Set PROTOCOL_TREASURY when ready. |
| Devnet | Build still produces .so; devnet only matters at deploy time. |

Do **not** overwrite or “redo” `wallet_gold.json` for build. Use it only when you run `solana program deploy`.
