# Kavach — Commands

## AMM program (`kavach_amm`)

**Check (no build artifact):**
```powershell
cd c:\126\DExs\Kavach\programs\kavach_amm
cargo check
```

**Build (native debug):**
```powershell
cd c:\126\DExs\Kavach\programs\kavach_amm
cargo build
```

**Build for Solana (BPF program):**
```powershell
cd c:\126\DExs\Kavach\programs\kavach_amm
cargo build-sbf
```
*(Requires Solana CLI; `build-sbf` replaces the older `build-bpf`.)*

---

## Router program (`kavach_router`) — when you’re ready

**Check:**
```powershell
cd c:\126\DExs\Kavach\programs\kavach_router
cargo check
```

**Build:**
```powershell
cd c:\126\DExs\Kavach\programs\kavach_router
cargo build
```

**Build for Solana:**
```powershell
cd c:\126\DExs\Kavach\programs\kavach_router
cargo build-sbf
```

---

## Quick reference

| What              | Command        | Where                    |
|-------------------|----------------|--------------------------|
| Check AMM         | `cargo check`  | `programs/kavach_amm`    |
| Check router      | `cargo check`  | `programs/kavach_router` |
| Build AMM (BPF)   | `cargo build-sbf` | `programs/kavach_amm` |
| Build router (BPF)| `cargo build-sbf` | `programs/kavach_router` |

Run `cargo check` first; use `cargo build` / `cargo build-sbf` when you need a binary.
