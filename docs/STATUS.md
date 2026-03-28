# Kavach — actual status (wallet vs coin, deploy, build)

## Wallet vs coin — they are not the same

| What | Meaning | Your value |
|------|---------|------------|
| **Wallet** | Keypair that signs: deploy, upgrade, pay fees. Its **public key** is the “deployer address”. | `wallet_gold.json` → **DivyQLtpP1iQUxsyPKZLPtYqvjGoRT3bqFnGrqYTCVKw** |
| **Coin (KVH)** | The **token mint** — an on-chain account whose address is the “mint address”. Used in UI/swap as “KVH”. | `KAVACH_MINT` in constants = **AJkyUCFTRD8113aFeaJxTvLKHAEtsheb6jAXLmsx2sh7** |

- **Wallet** = who you are (keypair). **Coin** = the KVH token’s mint address. They do **not** have to match.
- The wallet (e.g. wallet_gold) can **hold** KVH and SOL; it can be the **mint authority** of KVH if it created the token. The **mint address** (KAVACH_MINT) is fixed once the token is created; it is not the same as the wallet address.
- So: **no, the wallet is not supposed to “match” the coin.** The coin is the mint; the wallet is the signer/owner. Use wallet_gold as deployer/treasury; keep KAVACH_MINT as the real KVH mint address (see below).

## Is KAVACH_MINT correct?

- **Constants today:** `KAVACH_MINT = "AJkyUCFTRD8113aFeaJxTvLKHAEtsheb6jAXLmsx2sh7"`.
- **wallet_gold pubkey:** `DivyQLtpP1iQUxsyPKZLPtYqvjGoRT3bqFnGrqYTCVKw`.

So KAVACH_MINT is **not** your wallet address — it’s a different key. That’s what we want for a **mint** (mint address ≠ wallet address). If that mint was created by you (e.g. via deploy-kvh.ts) and you copied the **mint** address into constants, you’re good. If you never deployed KVH and AJkyUCF... was a placeholder or “set coin as wallet” from another key, then you need to **deploy KVH** once and set `KAVACH_MINT` to the **mint** address the script prints (not to wallet_gold’s address).

## What to set (final)

- **Deployer / upgrade authority:** Use `wallet_gold.json` for `solana program deploy` and scripts (`ANCHOR_WALLET=c:\126\files\wallet_gold.json`). No need to “match” the coin.
- **Protocol treasury:** Set `PROTOCOL_TREASURY` in `src/lib/constants.ts` to the address that should receive fees — e.g. **DivyQLtpP1iQUxsyPKZLPtYqvjGoRT3bqFnGrqYTCVKw** (wallet_gold) or your multisig **12tuVUnX6kiK5KGWybSoB97Yb4jKnXTodYGN9Ngn6srK**.
- **KVH (coin):** Keep `KAVACH_MINT` as the **mint** address of the KVH token. If you haven’t deployed KVH yet, run deploy-kvh.ts once (with wallet_gold as payer), then set `KAVACH_MINT` to the mint address the script outputs.

## What actually happened so far

| Step | Result |
|------|--------|
| **Check (router)** | Passed (warnings only). |
| **Check (kavach_amm_core)** | Passed (warnings only). |
| **Build (kavach_router)** | `cargo build-sbf` was started in background; confirm in terminal whether it finished and if `target/deploy/kavach_router.so` exists. |
| **Build (kavach_amm_core)** | Not run yet in this session. |
| **Deploy** | Not done. Need .so files + test SOL + `solana program deploy --keypair c:\126\files\wallet_gold.json`. |
| **PROTOCOL_TREASURY** | Still empty in constants — set to your wallet or multisig so fees are received. |
| **KVH / deploy-kvh** | No `deployment-info.json` in repo — so either KVH wasn’t deployed from this repo or output was not committed. If AJkyUCF... is the real KVH mint, leave it; otherwise deploy KVH and update KAVACH_MINT. |

## Short answers

- **Is the wallet supposed to match the coin?** No. Wallet = signer (e.g. wallet_gold). Coin = KVH mint address (KAVACH_MINT). They are different by design.
- **You set “coin as wallet” at the start — is it final?** If you set KAVACH_MINT to a **mint** address (not your wallet address), it’s correct. If you set it to your wallet address, change it to the real KVH **mint** address after you deploy the token.
- **Actual status:** Check done for router + Core. Build for router was started; verify .so and run build for Core. Deploy not done. Set PROTOCOL_TREASURY; confirm or set KAVACH_MINT from a real KVH deploy.
