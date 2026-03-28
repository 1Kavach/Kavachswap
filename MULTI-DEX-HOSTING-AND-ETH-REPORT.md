# One domain: Solana + ETH DEX (and Sui later) — Hosting & ETH DEX report

**Domain:** Your paid domain is in Cloudflare (see 5cloud.txt for registrar/account; keep private). **Hosting:** Cloudflare Pages free tier. **Solana DEX:** `126/DExs/Kavach`. **ETH DEX:** `5/DEX/ethms/ethdex`.

---

## 1. Can you host 2 DEXes (Solana + ETH) and add Sui later on one domain?

**Yes.** One domain can serve multiple apps (Solana DEX, ETH DEX, later Sui) in several ways.

### Option A — Path-based (recommended, simplest)

Use **one Cloudflare Pages project** and **one repo** (or one build that outputs everything):

| URL | What |
|-----|------|
| `https://yourdomain.com/` | Dashboard / home (or Solana as default). |
| `https://yourdomain.com/app.html` | **Solana DEX** (current Kavach React app). |
| `https://yourdomain.com/eth/` or `https://yourdomain.com/eth.html` | **Ethereum DEX** (ETH frontend). |
| `https://yourdomain.com/sui/` or `https://yourdomain.com/sui.html` | **Sui DEX** (when ready). |

- **Build:** Either (1) one Vite/Next app that has routes like `/`, `/eth`, `/sui` and builds to `dist/`, or (2) multiple apps built into subfolders (`dist/`, `dist/eth/`, `dist/sui/`) and copied into one `dist/` for Pages.
- **Cloudflare free tier:** One Pages project, one Git connection. Static files and client-side routing; no server. Bandwidth is generous. Your **paid domain** is just the domain; you attach it to that one project. So **one domain, one project, many paths** = 2 DEXes now, add Sui later.

### Option B — Subdomains

| URL | What |
|-----|------|
| `https://yourdomain.com` | Solana (or portal). |
| `https://eth.yourdomain.com` | ETH DEX. |
| `https://sui.yourdomain.com` | Sui DEX. |

- You’d use **multiple Pages projects** (or one project per subdomain with custom build output). Each project connects to a branch or folder. Cloudflare free tier allows multiple Pages projects; each gets a `*.pages.dev` URL; you add custom subdomains in DNS. So **one domain, multiple subdomains, multiple projects** = still fine on free tier + paid domain.

### Option C — Chain selector in one app (long-term)

- **Single SPA:** One app at `https://yourdomain.com` with a chain selector (Solana / Ethereum / Sui). When user picks a chain, the app loads that chain’s RPC, contracts, and UI (Swap, Pools, etc.). Same domain, one deployment; you add chains by adding config and adapters (see `126/files/MULTICHAIN-STACK.md`).

**Practical recommendation:** Start with **Option A**: keep Solana at `/` and `app.html`, add `/eth/` (or `eth.html`) for the ETH DEX when the ETH frontend is ready. Add `/sui/` later. All on the same Cloudflare Pages project and paid domain. No extra cost beyond the domain you already have.

---

## 2. Cloudflare free tier + paid domain — what you get

- **Pages (free):** Build from Git, output `dist/`. Unlimited bandwidth on free plan; 500 builds/month. Enough for 2 DEXes and more.
- **Domain:** You already have a paid domain on Cloudflare (in 5cloud.txt). Attach it to the Pages project: **Custom domains** → add `yourdomain.com` and `www.yourdomain.com`. SSL is automatic.
- **Env vars:** Set `VITE_SOLANA_RPC`, and when you add ETH, e.g. `VITE_ETH_RPC` and `VITE_ETH_CHAIN_ID`, in **Pages → Settings → Environment variables**. No need to put secrets in the repo.

You haven’t set up the domain yet; when you do: connect the repo to Pages, set build to `npm run build` and output `dist/`, add the custom domain, add env vars. Then you can add ETH (and later Sui) under the same project as paths or subfolders.

---

## 3. ETH DEX (`5/DEX/ethms/ethdex`) — completeness report

Summary after reading the repo and MULTICHAIN-STACK / deployment guide.

### What’s there (contracts)

| Item | File | Status |
|------|------|--------|
| **KVH token** | `Kavach.sol` | ✅ Implemented: 6B supply, no transfer fee, ERC20Permit, ERC20Votes, UUPS, Ownable. |
| **V3 factory** | `KavachV3Factory.sol` | ⚠️ Partial: Creates pools with fee tiers (0.05%, 0.30%, 1.00%), 0.01 ETH pool fee, but **instantiates a simplified `KavachV3Pool`** (see below). |
| **V3 pool** | Inside `KavachV3Factory.sol` | ❌ Stub: Only state (token0, token1, fee, sqrtPriceX96, tick). **No swap/mint/burn/collect** — comment says “use full Uniswap V3” in production. |
| **Swap router** | `KavachSwapRouter.sol` | ⚠️ Partial: `exactInputSingle` uses **constant-product (x*y=k)** in `_executeSwap` (reserves on pool). So it’s **not** real V3 concentrated liquidity; multi-hop `exactInput` **reverts** (“Not implemented”). |
| **Staking vault** | `KavachKVHStakingVault.sol` | ✅ Implemented: Tiered staking (Bronze/Silver/Gold/Platinum), lockups, rewards from fee source. |
| **Yield vault** | `KavachYieldAggregatorVault.sol` | Present (not fully read) — per guide, ERC-4626 style. |
| **Liquidity mining vault** | `KavachLiquidityMiningVault.sol` | Present (not fully read) — per guide, LP NFT rewards. |

### What’s missing or not production-ready

| Gap | What’s needed |
|-----|----------------|
| **Real V3 AMM** | Current “V3” pool is a stub. For real concentrated liquidity you need either: (1) **Use Uniswap V3 core** (fork or depend on existing V3 Factory/Pool) and only add your fee recipient / creation fee, or (2) Implement full V3 math (ticks, liquidity, swap in range) in your pool — non-trivial. |
| **Router ↔ pool** | Router’s `_executeSwap` reads `balanceOf(pool)` and does constant product. A real V3 pool doesn’t expose “reserves” that way; swap is tick-based. So **router and pool don’t match** for production V3. |
| **Multi-hop** | `exactInput` reverts; need path encoding and multi-pool swap if you want V3-style routing. |
| **Deploy tooling** | Guide references **Hardhat** (`npx hardhat run scripts/...`) but there are **no Hardhat config, no `package.json`, no deploy scripts** in the repo — only Python `script*.py` (specs/config, not deploy). You need: `package.json`, Hardhat (or Foundry), deploy scripts for token, factory, router, vaults. |
| **Frontend** | **No web app** in `ethdex`: no React/Vite, no wallet connect (e.g. Wagmi/RainbowKit), no Swap/Liquidity UI. Guide says “Next.js 14 + Wagmi + RainbowKit” — that doesn’t exist in this folder yet. |
| **Tests** | No test files (e.g. Hardhat/Foundry tests) in the repo. |
| **Config** | No `hardhat.config.js`, no network list (mainnet, Sepolia), no `.env.example` for RPC/keys. |

### Completeness summary (ETH DEX)

| Layer | Completion | Notes |
|-------|------------|--------|
| **Token (Kavach.sol)** | ~95% | Deploy + verify; tie to treasury. |
| **AMM (Factory + Pool)** | ~25% | Factory logic exists; pool is stub. Need real V3 or CPMM. |
| **Router** | ~40% | Single-hop uses constant product; not V3; multi-hop missing. |
| **Vaults (staking, yield, LP mining)** | ~60% | Staking implemented; others present but need wiring and tests. |
| **Deploy / scripts** | ~0% | No Hardhat/Foundry, no deploy scripts. |
| **Frontend** | ~0% | No UI. |
| **Overall ETH DEX** | **~30–35%** | Solid token + staking + design; AMM and router need real implementation and tooling; no deploy or frontend yet. |

### What the ETH DEX needs (concise)

1. **AMM:** Either integrate/fork Uniswap V3 (Factory + Pool) and add your fee/creation fee, or implement a **simple constant-product pool** and wire the existing router to it (so at least single-hop works with reserves).
2. **Router:** Either (a) use Uniswap V3 SwapRouter pattern and real V3 pools, or (b) keep constant-product and implement a minimal pool with `reserve0`/`reserve1` and proper swap/mint/burn.
3. **Deploy:** Add Hardhat (or Foundry), `package.json`, deploy scripts (token → fee splitter → staking → factory → router → create pools), and env/config for mainnet and testnet.
4. **Frontend:** Add a small app (e.g. Vite + React or Next.js) with wallet connect (Wagmi + RainbowKit or similar), Swap and Liquidity pages that call your router/factory, and chain/RPC config.
5. **Tests:** Unit tests for token, factory, router, vaults; integration test for deploy + swap.
6. **Docs:** Point MULTICHAIN-STACK and this report to the chosen deploy approach (V3 fork vs CPMM) once decided.

---

## 4. Hosting both DEXes on your domain (concrete)

- **Today:** Use **one Cloudflare Pages project** connected to the repo that contains the **Solana** app (e.g. `126/DExs/Kavach` or a monorepo that builds it). Set build command `npm run build`, output `dist/`. Add your **paid domain** in Pages → Custom domains. Set `VITE_SOLANA_RPC` (and fallbacks if you want) in env. Result: Solana DEX and dashboard live on your domain.
- **When ETH is ready:** Either (1) add an **ETH app** in the same repo under e.g. `apps/eth` or `eth/`, build it to `dist/eth/`, and add a redirect/route so `https://yourdomain.com/eth/` serves it, or (2) add a second Pages project for ETH and use a subdomain like `eth.yourdomain.com`. Same domain, optional second project.
- **Sui later:** Same idea: path `https://yourdomain.com/sui/` or subdomain `sui.yourdomain.com`, same or another project.

So: **yes, you can host 2 DEXes (Solana + ETH) and add Sui later on one domain**, with Cloudflare free tier and your paid domain. Start with Solana; add ETH when the ETH stack has at least a minimal AMM + deploy + frontend.

---

## 5. File reference

| Topic | Location |
|-------|----------|
| Domain / Cloudflare account | `126/files/5cloud.txt` (keep private) |
| Solana DEX | `126/DExs/Kavach` |
| ETH DEX contracts & guide | `5/DEX/ethms/ethdex` (Kavach*.sol, kvh_deployment_guide.txt, kvh_vault_architecture.txt) |
| Multi-chain strategy | `126/files/MULTICHAIN-STACK.md` |
| Cloudflare + deploy FAQs | `126/DExs/Kavach/CLOUDFLARE-DEPLOY-AND-FAQS.md` |
| Hosting (Pages, domain) | `126/DExs/Kavach/HOSTING.md` |
