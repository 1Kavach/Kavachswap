# Kavach Core AMM — Security checklist (from soldexplex.md)

Two items to complete for mainnet readiness:

---

## 1. security.txt (Neodyme) — ✅ In code; verify after deploy

- **Status:** The `security_txt!` macro is in `src/lib.rs` with:
  - `project_url`: https://kavachswap.com
  - `contacts`: link + email (create a `/security` page and security@ when live)
  - `policy`: no bug bounty; responsible disclosure
  - `expiry`: 2027-12-31

**Before/after deploy:**
1. Add a **/security** page on kavachswap.com with contact and policy (so you can change it without upgrading the program).
2. After deploy: `cargo install query-security-txt` then  
   `query-security-txt target/deploy/kavach_amm_core.so`  
   to confirm the blob is in the binary.
3. On Solana Explorer: open the program address → **Security** tab to see the on-chain security.txt.

---

## 2. Verifiable build (Solana Foundation) — Run after deploy

So anyone can verify the deployed binary matches your public source.

**Steps (from soldexplex.md):**
1. Install: `cargo install solana-verify`
2. Build: `solana-verify build` (reproducible Docker env)
3. Deploy as usual: `solana program deploy target/deploy/kavach_amm_core.so --program-id ...`
4. Verify and upload:  
   `solana-verify verify-from-repo -u $NETWORK_URL --program-id 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM https://github.com/YOUR_ORG/YOUR_REPO`
5. Submit:  
   `solana-verify remote submit-job --program-id 9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM --uploader $YOUR_PUBKEY`

After verification, explorers can show a **verified** badge. Not a substitute for an audit.

---

## Reference

- security.txt: [neodyme-labs/solana-security-txt](https://github.com/neodyme-labs/solana-security-txt)
- Verifiable build: [solana-foundation/solana-verifiable-build](https://github.com/solana-foundation/solana-verifiable-build)
- Status and log: `126/files/soldexplex.md` (Protocol status log)
