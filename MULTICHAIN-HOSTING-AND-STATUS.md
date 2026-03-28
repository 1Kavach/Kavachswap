# Multi-chain hosting (one domain) + ETH & Sui DEX status

**Domain:** kavachswap.com (Cloudflare Registrar, in 5cloud.txt). **Hosting:** Cloudflare Pages free tier + paid domain. **Goal:** One site for Solana DEX, then ETH DEX, then Sui (and more later).

---

## 1. Can you host 2 DEXes (Solana + ETH) and add more (e.g. Sui) on one domain?

**Yes.** Cloudflare Pages free tier and your paid domain are enough.

| What | How |
|------|-----|
| **One domain** | kavachswap.com (and www) point to a **single** Cloudflare Pages project. |
| **One repo or one build** | You have two options: **(A)** One repo that builds **one** app (e.g. Vite/React) with a **chain selector** (Solana / Ethereum / Sui). The same HTML/JS is served; the app switches RPC and contracts per chain. **(B)** One repo with **multiple build outputs** or **subpaths**: e.g. `/` = Solana DEX, `/eth` = ETH DEX, `/sui` = Sui DEX (each can be a different app or the same app with different entry). |
| **Cloudflare free tier** | 500 builds/month, unlimited bandwidth. Serving 2 or 3 chain UIs from one site is just more static JS; no extra cost. |
| **Adding more chains later** | Add a new chain in your app (new RPC, new contract/package IDs, new tab or route) and redeploy. No need for a new domain. |

**Recommended:** One **portal** app (e.g. current Solana Kavach app) that gains a **chain selector** and loads Solana / Ethereum / Sui based on selection. Same domain (kavachswap.com), same deployment. See **126/files/MULTICHAIN-STACK.md** for the single-frontend approach.

**Subpath option:** If you prefer separate “sites” per chain:  
- `kavachswap.com` → Solana (current)  
- `kavachswap.com/eth` → ETH DEX (e.g. another Vite app in a subfolder or monorepo, build output to `dist/eth`)  
- `kavachswap.com/sui` → Sui DEX  

Configure build so each app’s output is under a subpath, and use Cloudflare Pages **redirects** or a **single SPA** that lazy-loads per route. All still one domain, one Pages project.

---

## 2. Domain setup (you haven’t set anything up yet)

Your domain **kavachswap.com** is on Cloudflare (from 5cloud.txt: KAVACHSWAP.COM, Cloudflare WHOIS). To go live:

| Step | Action |
|------|--------|
| 1. Repo | Push the Kavach (Solana) app to a Git repo (GitHub/GitLab) if not already. |
| 2. Pages | Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select repo. |
| 3. Build | Build command: `npm run build`. Output directory: `dist`. (Use `126/DExs/Kavach` as root if the repo is the whole repo, or set root to the Kavach folder if your repo contains multiple projects.) |
| 4. Domain | In the Pages project → **Custom domains** → Add **kavachswap.com** and **www.kavachswap.com**. DNS is already on Cloudflare, so records are created automatically. |
| 5. Env | **Settings** → **Environment variables** (Production): add `VITE_SOLANA_RPC` = your mainnet RPC URL (e.g. Helius). Never commit keys; use 4.txt/5cloud.txt only locally. |

After that, every **git push** to the connected branch triggers a new build and deploy. No extra cost beyond your paid domain.

---

## 3. ETH DEX — how complete and what it needs

**Location:** `5/DEX/ethms/ethdex`.

### What’s there

| Item | Status | Notes |
|------|--------|-------|
| **Kavach.sol** | Complete | KVH 6B, ERC20Permit, Votes, UUPS, no transfer fees. |
| **KavachSwapRouter.sol** | Complete | Exact-in/out, slippage, deadline; uses factory `getPool` and pool for swap. |
| **KavachV3Factory.sol** | Partial | Factory logic + fee tiers + pool creation fee; **creates** a pool contract. |
| **KavachV3Pool** (in same file) | **Stub only** | Only constructor and state (sqrtPriceX96, tick). **No** `swap`, `mint`, `burn`, or `collect`. Comment says: “For production, use full Uniswap V3 contracts.” |
| **Vaults** | Present | Staking, Yield, Liquidity Mining (skeleton/reference). |
| **Deploy guide** | Present | `kvh_deployment_guide.txt` — sequence: KVH → Fee Splitter → Staking → Factory → Router → pools. |
| **Scripts** | Python | script_*.py (e.g. generate or deploy); no Hardhat/Foundry deploy scripts in the folder. |
| **Frontend** | **Missing** | No React/Vite DEX UI in ethdex (no swap/liquidity UI, no wallet connect for EVM). |

### What the ETH DEX needs

| # | What | Effort |
|---|------|--------|
| 1 | **Real V3 pool implementation** | **Critical.** Either (a) use **Uniswap V3 Core** (Pool.sol) and only replace Factory/Router with your fee/treasury logic, or (b) implement full V3 pool (tick math, liquidity, swap, mint, burn, collect). The current `KavachV3Pool` stub will make any router call that touches the pool fail. |
| 2 | **Deploy pipeline** | Hardhat or Foundry scripts for: deploy KVH → Factory → Router (and optionally vaults); verify on Etherscan; save addresses. |
| 3 | **Frontend** | DEX UI: wallet connect (e.g. MetaMask, WalletConnect), swap, create pool, add/remove liquidity, chain selector. Can reuse flow from Solana Kavach and plug in ethers/viem + your Factory/Router/Pool addresses. |
| 4 | **Network choice** | Decide chain: Ethereum mainnet, or L2 (Base, Arbitrum, etc.) for lower gas. Configure RPC and chainId in app and deploy scripts. |
| 5 | **WETH** | Router already expects WETH; set correct WETH address per chain in deploy and frontend. |

**Rough completeness:** **~35–40%** — token and router/factory design are there; the **pool is a placeholder** and there is **no DEX UI**. Completing the pool (or integrating Uniswap V3 Core) plus deploy scripts and a minimal swap/liquidity UI would bring it to “launchable.”

---

## 4. Sui DEX — how complete and what it needs

**Location:** `126/folder/suidex`.

### What’s there

| Item | Status | Notes |
|------|--------|-------|
| **amm.move** | Complete | CPMM (x*y=k), Pool, LPToken, create pool, swap (base↔quote), add/remove liquidity, fee_bps, MINIMUM_LIQUIDITY, events. |
| **router.move** | Complete | Single-hop and two-hop swaps, slippage (min_out). |
| **math.move** | Present | Math helpers for AMM. |
| **token_factory.move** | Present | Token creation. |
| **kvusd.move** | Present | Stablecoin module. |
| **protocol_tests.move** | Present | Tests. |
| **Move.toml** | Present | Package `kavach`, Sui framework (testnet rev); `kavach = "0x0"` (replace with package ID after publish). |
| **Frontend** | Partial | `package.json`: Vite + React + `@mysten/sui.js` + wallet adapter. **No `src/`** in the repo — only a large **index.html** (single-file UI). So either the UI is all in that HTML or a React app (e.g. `src/`) still needs to be added and wired to the Move packages. |

### What the Sui DEX needs

| # | What | Effort |
|---|------|--------|
| 1 | **Publish Move package** | Build (`sui move build`) and publish to Sui testnet/mainnet. Replace `kavach = "0x0"` with the **published package ID** in Move.toml and in the frontend config. |
| 2 | **Frontend wiring** | A real app (e.g. React in `src/`) that: connects Sui wallet (Sui Wallet, etc.), reads pool state and builds **move call** txs for swap and add/remove liquidity using the **published** package ID and module/function names. The current single HTML file can be a prototype; for production you’ll want components and clear RPC/package config. |
| 3 | **RPC** | Set Sui RPC URL (e.g. BlockVision or Sui public RPC) in env or config; use it in the frontend and for SDK. |
| 4 | **Token types** | Your AMM is generic (Base/Quote); you need at least one “quote” coin type (e.g. SUI or a wrapped coin). Create or use existing coin types and create the first pool(s) via your AMM. |
| 5 | **Chain (testnet vs mainnet)** | Move.toml uses `framework/testnet`; for mainnet you’ll use the mainnet framework and publish to mainnet. |

**Rough completeness:** **~65–70%** — **Move side is largely done** (AMM + router + token factory + kvusd). Missing: **publishing the package**, a **proper frontend** that talks to it, and **first pool creation** on-chain.

---

## 5. Summary table

| Chain | Location | Backend | Frontend | Deploy / config | Rough completion |
|-------|----------|---------|----------|-----------------|------------------|
| **Solana** | 126/DExs/Kavach | Core AMM + Router deployed | Full (Swap, Liquidity, Pools, Token Factory, Launch, Portfolio) | RPC + domain + Pages | **~90%** (live-ready) |
| **Ethereum** | 5/DEX/ethms/ethdex | KVH + Factory + Router; **Pool is stub** | **None** | No Hardhat/Foundry deploy; no UI | **~35–40%** |
| **Sui** | 126/folder/suidex | AMM + Router + token_factory + kvusd (Move) | Single HTML + deps; **no full app in src/** | Package not published; no package ID in UI | **~65–70%** |

---

## 6. Hosting both DEXes and more on kavachswap.com

- **Yes:** One domain (kavachswap.com), Cloudflare free tier + paid domain, can serve **Solana + ETH + Sui** (and more later).
- **Ways to do it:**  
  - **Single app with chain selector** (recommended in MULTICHAIN-STACK.md): one build, one deploy; user picks chain and the app uses that chain’s RPC and contracts.  
  - **Subpaths:** e.g. `/` = Solana, `/eth` = ETH, `/sui` = Sui (each can be a different bundle or the same app with different routes).  
- **Domain setup:** Connect Git to Cloudflare Pages, set build to `npm run build` and output `dist`, add kavachswap.com (and www) under Custom domains, set env vars (e.g. `VITE_SOLANA_RPC`). Details in **HOSTING.md** and **CLOUDFLARE-DEPLOY-AND-FAQS.md**.
