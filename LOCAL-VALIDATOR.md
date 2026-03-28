# Run AMM on localhost — full commands

Use a **local Solana test validator** so you can test Create Pool, Add Liquidity, and Swap without devnet/mainnet. All commands assume Windows (PowerShell); adjust paths if needed.

**Official docs:** [Solana Test Validator (Agave)](https://docs.solana.com/developing/test-validator)  
**Developer resources (security / tooling):** See `126/files/soldexplex.md` — Solsec, SolShield, Solana Program Examples, docs.solana.com.

---

## 0. Before you start (avoid “dead” validator state)

If you previously ran the validator and it crashed or you deleted files, **clean old ledger state** so the next run starts fresh:

```powershell
# From any folder; use the folder where you will run solana-test-validator (e.g. project root or home)
Remove-Item -Recurse -Force test-ledger -ErrorAction SilentlyContinue
```

Then install/verify the Solana CLI (includes `solana-test-validator`):

- **Install:** https://docs.solana.com/cli/install  
- **Verify:** `solana --version` and `solana-test-validator --help`

**Windows note:** The test validator has known issues on native Windows (e.g. “Failed to create ledger”, hangs). If it doesn’t start after cleaning `test-ledger`:
- **Option A:** Run it from **WSL (Ubuntu)** in the same project path (recommended by Solana/Agave).
- **Option B:** Use a **different working directory** (e.g. `cd C:\126\DExs\Kavach` or a short path without spaces) and run `solana-test-validator` there after deleting `test-ledger` in that directory.

---

## 1. Start the test validator

**Terminal 1** — leave this running:

```powershell
solana-test-validator
```

Wait until you see something like:

```
JSON RPC URL: http://127.0.0.1:8899
```

Keep this terminal open. The validator must stay running while you test.

---

## 2. Point Solana CLI at localhost

**Terminal 2** (new terminal):

```powershell
solana config set --url http://127.0.0.1:8899
```

Check:

```powershell
solana config get
```

You should see `RPC URL: http://127.0.0.1:8899`.

---

## 3. Set keypair and airdrop SOL

Use the wallet that will pay for deploy and txs (e.g. your default keypair or a specific one):

```powershell
solana config set --keypair "c:\126\files\wallet_0.json"
```

Or another keypair path. Then airdrop SOL:

```powershell
solana airdrop 2
```

If you use a specific address:

```powershell
solana airdrop 2 <YOUR_PUBKEY>
```

Check balance:

```powershell
solana balance
```

You should see at least 2 SOL. Repeat `solana airdrop 2` if you need more (no rate limit on localhost).

---

## 4. Build and deploy Core AMM to localhost

From the Kavach repo:

```powershell
cd c:\126\DExs\Kavach\programs\kavach_amm_core
cargo build-sbf
```

Then deploy (same terminal, validator must be running):

```powershell
solana program deploy target/deploy/kavach_amm_core.so --program-id target/deploy/kavach_amm_core-keypair.json --url http://127.0.0.1:8899
```

Note the **Program Id** printed (e.g. `9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`). If you deploy to localhost, the ID will be the one from that keypair file.

**Optional — deploy Router** (if you want to test routing):

```powershell
cd c:\126\DExs\Kavach\programs\kavach_router
cargo build-sbf
solana program deploy target/deploy/kavach_router.so --program-id target/deploy/kavach_router-keypair.json --url http://127.0.0.1:8899
```

---

## 5. Point the frontend at localhost

In the Kavach project root, create or edit **`.env`**:

```powershell
cd c:\126\DExs\Kavach
```

Create `.env` with:

```
VITE_SOLANA_RPC=http://127.0.0.1:8899
```

If you deployed to localhost with a **different** program ID than mainnet, update **`src/lib/constants.ts`** so `KAVACH_AMM_CORE_PROGRAM_ID` (and router ID if used) matches the IDs printed in step 4.

---

## 6. Run the app and test

**Terminal 2** (or a third terminal):

```powershell
cd c:\126\DExs\Kavach
npm run dev
```

Open in the browser:

- **http://localhost:5173/app.html** — DEX (Swap, Liquidity, Create Pool, Launch Token)

Connect Phantom (or another wallet). **Important:** In Phantom, switch the network to **Localhost** (or add Custom RPC `http://127.0.0.1:8899`). Then use “Add / Import” and import the **same** keypair you used for airdrop (e.g. wallet_0) so the wallet has SOL on localhost.

Then you can:

1. **Create Pool** — pick two mints (e.g. KVH + SOL), create pool (pays rent + protocol fee if set).
2. **Add Liquidity** — add to that pool.
3. **Swap** — swap on your AMM or via Jupiter (Jupiter may not have localhost pools; use your AMM path).

---

## Quick copy-paste summary

**Terminal 1 (validator):**

```powershell
solana-test-validator
```

**Terminal 2 (config + airdrop + deploy + dev):**

```powershell
solana config set --url http://127.0.0.1:8899
solana config set --keypair "c:\126\files\wallet_0.json"
solana airdrop 2
solana balance
cd c:\126\DExs\Kavach\programs\kavach_amm_core
cargo build-sbf
solana program deploy target/deploy/kavach_amm_core.so --program-id target/deploy/kavach_amm_core-keypair.json --url http://127.0.0.1:8899
cd c:\126\DExs\Kavach
echo VITE_SOLANA_RPC=http://127.0.0.1:8899 > .env
npm run dev
```

Then open **http://localhost:5173/app.html**, set Phantom to Localhost, and test.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `solana-test-validator` not found | Install [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools). |
| "Failed to create ledger" / blockstore error / validator hangs | Delete old state: `Remove-Item -Recurse -Force test-ledger -ErrorAction SilentlyContinue` in the folder where you run the validator. Restart. On Windows, if it still fails, run the validator inside **WSL (Ubuntu)**; see [Agave #24](https://github.com/anza-xyz/agave/issues/24). |
| "Extra entry when unpacking archive" / ledger errors | Remove `test-ledger` and restart; do not reuse a corrupted or partially deleted ledger. |
| Airdrop fails | Ensure the validator (Terminal 1) is running and you ran `solana config set --url http://127.0.0.1:8899`. Wait until Terminal 1 shows "JSON RPC URL: http://127.0.0.1:8899" before running airdrop. |
| Phantom won’t connect | Use the app at **http://localhost:5173/app.html** (not file://). Add Custom RPC in Phantom: http://127.0.0.1:8899. |
| “Insufficient funds” on tx | Run `solana airdrop 2` again; confirm keypair in Phantom matches the one you airdropped to. |
| Program ID mismatch | After local deploy, the Core AMM program ID is from `programs/kavach_amm_core/target/deploy/kavach_amm_core-keypair.json`. If it differs from mainnet, set `KAVACH_AMM_CORE_PROGRAM_ID` in `src/lib/constants.ts` to the deployed ID for local testing. |

**Developer help (security & testing):** Solsec, SolShield, Solana Program Examples, and official docs are linked in `126/files/soldexplex.md` (Resources & edge section). Use them for static analysis and pre-audit checks after the validator is running.
