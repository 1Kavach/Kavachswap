# Kavach Finishing Guide — Go Live, Domain, Token Launch & Stablecoin

**Use this to complete the protocol so you can use your domain, go live, then launch the token. All production: mainnet only (no devnet for users).**

---

## 1. Order of operations (high level)

| Step | What | When |
|------|------|------|
| **1. Local (optional)** | Run local validator + frontend to smoke-test flows (see LOCAL-VALIDATOR.md). | Before or in parallel with deploy. |
| **2. Domain + hosting** | Point kavachswap.com to Cloudflare Pages; set env (RPC, etc.). | Before “user ready.” |
| **3. Security tasks** | Do the **two** security tasks in soldexplex.md (security.txt + verifiable build). | **Before** or **right after** mainnet program deploy. |
| **4. Go live** | Deploy frontend; ensure RPC is **mainnet**; test connect, swap, liquidity, portfolio. | When you’re ready for public traffic. |
| **5. Launch token** | Create KVH (or your token), create pool, add liquidity; link from site. | After site is live. |
| **6. Stablecoin (later)** | Deploy KVUSD per stablesolana.txt; add Mint/Redeem (or link); keep it **not dependent on DEX**. | After DEX + KVH have liquidity. |

---

## 2. Mainnet only (no devnet for users)

- **User-facing app and docs:** mainnet only. No devnet in production.
- **RPC:** Set `VITE_SOLANA_RPC` to a **mainnet** URL (e.g. Helius, publicnode). See `126/files/315.txt`.
- **Wallet / cluster:** Users connect to mainnet; all balances, pools, and swaps are mainnet.
- **Local validator:** Only for your own testing (LOCAL-VALIDATOR.md); never for “user ready” production.

---

## 3. The two security tasks (from soldexplex.md)

Both are in **`126/files/soldexplex.md`** (search for “security.txt” and “Verifiable build”).

### Task 1 — security.txt (Neodyme)

- **What:** Embed a security contact blob in the **AMM program binary** so researchers can find you (e.g. Solana Explorer → program → Security).
- **Where:** Core AMM program that holds TVL, e.g. **`9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`**.
- **How:** Use `solana-security-txt` crate; `security_txt!` macro with at least: `name`, `project_url`, `contacts`, `policy`. Prefer a URL for policy (e.g. `https://kavachswap.com/security`) so you can update without redeploying.
- **When:** Before or right after mainnet deploy; verify with `query-security-txt` on the `.so` before deploy.

### Task 2 — Verifiable build (Solana Foundation)

- **What:** Prove that the deployed program binary matches your public source (deterministic build + verify-from-repo).
- **How:** `solana-verify build` → deploy → `solana-verify verify-from-repo` → `solana-verify remote submit-job`. See soldexplex.md and `programs/kavach_amm_core/VERIFIABLE-BUILD.md`.
- **When:** After the program is deployed to mainnet; then anyone can see the “verified” badge.

**Summary:** Do **security.txt** before or at deploy; do **verifiable build** after deploy. Both improve trust; they are not a substitute for a full audit if you hold significant TVL.

---

## 4. Domain, hosting, and going live

- **Domain:** kavachswap.com (Cloudflare; you paid ~$10).
- **Hosting:** Cloudflare Pages (free). Build: `npm run build`; output: `dist/`. Custom domain: kavachswap.com + www.
- **Env (production):** In Cloudflare Pages → Settings → Environment variables set **mainnet** `VITE_SOLANA_RPC` (and optional `VITE_SOLANA_RPC_FALLBACKS`). Never commit keys; use env only (see 315.txt).
- **Entry points:**  
  - **Dashboard / home:** `index.html` (or root).  
  - **DEX (Swap, Liquidity, Portfolio, etc.):** `app.html`.  
  - **KVUSD page:** Dashboard → KVUSD tab, or direct link `index.html#kvusd` (and same for `Kavach-3D-Enterprise-Dashboard.html#kvusd`).

---

## 5. Link so users can return to the KVUSD page

- **From the DEX (app.html):** A “Dashboard” or “KVUSD” link in the header/nav points to the dashboard with the KVUSD tab open: **`index.html#kvusd`** (or `Kavach-3D-Enterprise-Dashboard.html#kvusd` if that’s your main dashboard URL).
- **Dashboard:** On load, the dashboard reads `location.hash`; if it’s `#kvusd` (or `#pools`, `#portfolio`, etc.), it opens that tab so deep links work.

---

## 6. Dashboard backup

- A full copy of the dashboard is saved in the same folder: **`Kavach-3D-Enterprise-Dashboard-BACKUP.html`**. Use it as a backup; keep it in sync when you make big dashboard changes.

---

## 7. Best way to integrate stablecoin (not dependent on DEX)

From **`126/files/STABLECOIN-FIT.md`** and **`126/files/soldexplex.md`**:

- **Design:** Over-collateralized **KVUSD** (peg to USD). Collateral: **SOL + USDC only** at first (Pyth). Add KVH as collateral only after KVH has real price discovery.
- **Do not make the stablecoin depend on the DEX being up:**
  - **Solvency:** Backed by collateral in a vault; users can **redeem** (burn KVUSD → withdraw collateral) even if the DEX is down.
  - **Liquidations:** Use a small **liquidation bot** (script or worker) that calls `liquidate` when ratio &lt; threshold. Optionally use the AMM to sell collateral → KVUSD for liquidations, but the stable’s existence and peg do **not** rely on DEX volume.
  - **Oracles:** Pyth for SOL/USDC only; no placeholder prices. KVH oracle only when the pool exists and is deep enough (TWAP or real feed).
- **Where it lives:** Same site (kavachswap.com): add a **KVUSD** section (tab or page): Mint (deposit SOL/USDC → KVUSD), Redeem (burn KVUSD → collateral), optional “My vault” (collateral, debt, health). Dashboard already has a KVUSD tab; when the KVUSD program is deployed, wire that tab to real Mint/Redeem or link to your KVUSD UI.

---

## 8. How complete is the stablecoin?

- **Main stable doc:** **`126/files/stablesolana.txt`** (2,269 lines) — this is the **main** stablecoin design and production-style code (KVUSD, vaults, fees, Pyth, liquidation).  
- **Other file:** **`126/files/stable35.txt`** (813 lines) — **Stable AMM** audit (curve invariant, router account count, etc.). It’s about the **Stable AMM** program, not the KVUSD stablecoin program itself.

**Stablecoin (KVUSD) readiness:**

| Piece | Status | Notes |
|-------|--------|--------|
| Design & economics | Done | stablesolana.txt: over-collateralized, SOL/USDC, fees, liquidations. |
| Program code (Anchor-style) | Draft in doc | Full program structure in stablesolana.txt; needs to be extracted, built, and tested. |
| Pyth oracles | Not wired | SOL/USDC feeds to be integrated; no placeholder in production. |
| Audit | Not done | Required before mainnet TVL; run Solsec/SolShield as pre-audit. |
| Mint/Redeem UI | Placeholder | Dashboard KVUSD tab exists; wire to program when deployed. |

**Rough completion:** **~40–50%** — design and code draft are there; build, oracles, audit, and UI wiring remain.

---

## 9. How complete is the DEX (with or without stable)?

**DEX without stablecoin:**

| Piece | Status | Notes |
|-------|--------|--------|
| Frontend (Swap, Liquidity, Pools, Create Pool, Token Factory, Launch, Portfolio) | Done | React app in `src/`; works on mainnet with RPC. |
| Jupiter swap | Done | Best execution for swap. |
| Core AMM (create pool, add/remove liquidity, swap) | Deployed | Program `9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM`; use from frontend. |
| RPC fallback | Done | connection.ts; freetier/403 handled. |
| Token creation + protocol fee | Done | PROTOCOL_TREASURY in constants. |
| Portfolio (balances, history, Get SOL, stable spot) | Done | No Transak; Get SOL links + KVUSD “coming soon.” |
| Domain + hosting | Ready | kavachswap.com, Cloudflare Pages; env for mainnet RPC. |

**Rough completion (DEX only):** **~85–90%** — go-live ready once RPC is mainnet and (recommended) security.txt + verifiable build are done.

**DEX with stablecoin:**

- **Stable AMM (curve):** Separate program (Kavach Stable); audit in stable35.txt (e.g. invariant, router 9 vs 8 accounts). Fix those before using for KVUSD pairs.
- **KVUSD:** As above (~40–50%); adds Mint/Redeem and optional liquidation path via AMM.
- **Rough completion (DEX + stable):** **~55–65%** — DEX is ready; stablecoin is design + draft code + audit/impl/wire left.

---

## 10. Quick checklist

- [ ] **Mainnet only:** `VITE_SOLANA_RPC` and any docs point to mainnet; no devnet for users.
- [ ] **Security:** Complete security.txt (Neodyme) and verifiable build (soldexplex.md).
- [ ] **Domain/hosting:** Cloudflare Pages + kavachswap.com; env vars set; build from `dist/`.
- [ ] **Dashboard link:** From DEX, “Dashboard” / “KVUSD” → `index.html#kvusd`; dashboard opens KVUSD tab from hash.
- [ ] **Backup:** `Kavach-3D-Enterprise-Dashboard-BACKUP.html` kept as copy of dashboard.
- [ ] **Go live:** Test connect, swap, liquidity, portfolio on mainnet; then open to users.
- [ ] **Launch token:** Create token → create pool → add liquidity; link from site.
- [ ] **Stablecoin (later):** Extract/build KVUSD from stablesolana.txt; Pyth; audit; Mint/Redeem UI; keep stable not dependent on DEX.

---

## 11. File reference

| Topic | File |
|-------|------|
| Status, security tasks, roadmap | **126/files/soldexplex.md** |
| RPC list, AMM addresses, .env | **126/files/315.txt** |
| Stablecoin fit, not DEX-dependent | **126/files/STABLECOIN-FIT.md** |
| Main stablecoin design & code | **126/files/stablesolana.txt** |
| Stable AMM audit (curve, router) | **126/files/stable35.txt** |
| Local validator | **126/DExs/Kavach/LOCAL-VALIDATOR.md** |
| Hosting, domain | **126/DExs/Kavach/HOSTING.md** |

**Main stable:** **stablesolana.txt** is the main stablecoin (KVUSD). **stable35.txt** is the Stable AMM audit, not the stablecoin token program.
