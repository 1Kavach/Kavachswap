# Kavach site — what’s what, why DEX is blank, and how to host

---

## Check before you run dev

Run these in the project folder (`c:\126\DExs\Kavach`) so you know the project is ready.

| Step | Command | What to expect |
|------|---------|----------------|
| 1. Dependencies | `npm install` | Finishes with “added X packages” or “up to date”. If it fails, fix Node/npm (e.g. install Node 20+ from nodejs.org). |
| 2. Dev server | `npm run dev` | Vite starts and prints e.g. `Local: http://localhost:5173/`. No need to run build for dev. |
| 3. Open DEX in browser | Open **http://localhost:5173/app.html** | You should see the DEX (Swap, Liquidity, Pools, Token Factory, Launch). |
| 4. (Optional) Production build | `npm run build` | Creates `dist/` for hosting. If this fails, see “Current build status” below. |

**Quick check (all in one):**

```powershell
cd c:\126\DExs\Kavach
npm install
npm run dev
```

Then in the browser open: **http://localhost:5173/** for the dashboard, or **http://localhost:5173/app.html** for the DEX.

### Current build status

- **`npm install`** — OK.
- **`npm run dev`** — OK (Vite starts; DEX and dashboard at http://localhost:5173/ and /app.html).
- **`npm run build`** — OK (produces `dist/`). Deploy `dist/` for hosting.

---

## What is “Open DEX (Swap / Liquidity)”?

- **Dashboard** (`index.html`) = overview: TVL, volume, pools list, charts. No trading.
- **Open DEX** = link to **app.html** = the actual **DEX**: Swap, Add/Remove Liquidity, Pools. That’s the React app (Vite + TypeScript).

So: **Swap** = trade tokens; **Liquidity** = add/remove LP. Both live in the React app loaded by `app.html`.

---

## Why is the DEX page empty?

`app.html` is only a **shell**. It has:

```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

- The real UI is built by the **React app** (`src/main.tsx` → `App.tsx` etc.).
- That app must be **built** (compiled) and the browser must load the **built JS**, not raw `main.tsx`.

If you open `app.html` by itself (file:// or a server that only serves the repo as static files):

- The browser asks for `/src/main.tsx`, which isn’t a built file, so nothing runs and `#root` stays empty → **blank page**.

So the DEX is “empty” when:

1. You haven’t run a **build** and you’re serving the repo as plain files, or  
2. You’re not using the **built output** (the `dist/` folder) when hosting.

---

## How to run the DEX locally (so it’s not empty)

Use the **“Check before you run dev”** steps above. In short:

From the Kavach repo root:

```powershell
cd c:\126\DExs\Kavach
npm install
npm run dev
```

Then open **http://localhost:5173/** (dashboard) or **http://localhost:5173/app.html** (DEX).  
For production you fix the build errors, run `npm run build`, and host the `dist/` folder:

```bash
npm run build
```

The built site is in **`dist/`**. You host that folder (see below).

---

## Hosting options (and “buy website”)

You have a few ways to **host** the site. “Buy website” usually means either (1) **buy a domain name** (e.g. `kavach.io`) or (2) **pay for hosting**. You can also host for **free** and only pay for a domain if you want.

### 1. GitHub Pages (free, good for static sites)

- **Yes, you can “Git host” and host the site on GitHub.**
- Push your repo to GitHub, then either:
  - Use **GitHub Actions** to run `npm run build` and deploy the contents of `dist/` to the `gh-pages` branch (or to a branch/docs folder), or  
  - Build locally (`npm run build`) and push the contents of `dist/` to a branch GitHub Pages uses (e.g. `gh-pages`).
- GitHub serves the built files. Your site will be at `https://<username>.github.io/<repo>/` or a custom domain if you add one.
- **Free.** You only “buy” a domain if you want something like `kavach.io` instead of `username.github.io/repo`.

### 2. Custom domain (e.g. like 1mantisshrimp.online)

- **1mantisshrimp.online** = you (or someone) bought that domain and pointed it at a host (GitHub Pages, Vercel, Netlify, or a VPS).
- For Kavach you can:
  - Use a **subdomain** of a domain you own (e.g. `kavach.1mantisshrimp.online`), or  
  - **Buy a new domain** (e.g. Namecheap, Cloudflare, Google Domains) and point it to the same host you use for the build (GitHub Pages, Vercel, etc.).

### 3. Vercel / Netlify (free tier, easy for React)

- Connect your GitHub repo to **Vercel** or **Netlify**.
- Set **build command**: `npm run build`  
- Set **output directory**: `dist`
- They run the build and host the `dist/` output. You get a URL like `kavach-xxx.vercel.app`. You can add a custom domain later.
- Free tier is usually enough for a DEX frontend.

### 4. Your own server / VPS

- Run `npm run build`, upload the contents of `dist/` to the server, and serve them with nginx/Apache or any static host. You can point 1mantisshrimp.online (or another domain) to this server.

### 5. Cloudflare Pages + kavachswap.com (recommended)

**Domain:** `kavachswap.com` (Cloudflare Registrar; nameservers already on Cloudflare). Cost: domain renewal only (~$10/year); hosting is free.

**Step 1 — Connect Vite build to Cloudflare Pages**

- **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.** Point at your repo.
- **Build settings:** Build command: `npm run build`. Output directory: `dist`.
- Every `git push` auto-deploys. Free tier: unlimited bandwidth, 500 deploys/month.

**Step 2 — Custom domain**

- **Pages → your project → Custom domains:** Add `kavachswap.com` and `www.kavachswap.com`. DNS records are created automatically (domain already on Cloudflare). SSL is free (Universal SSL).

**Step 3 — Environment variables**

- **Settings → Environment variables** (Production): add `VITE_SOLANA_RPC` = your RPC URL (e.g. Helius or Chainstack). Do **not** commit RPC URLs or API keys to the repo. Use a paid/free RPC tier for production (e.g. Helius free tier for starting).

**Step 4 — SPA routing**

- The repo includes `public/_redirects`. It is copied to `dist/` on build so Cloudflare Pages serves:
  - `/app.html` → DEX (Swap, Liquidity, Pools, Token Factory, Launch).
  - Any other path → `index.html` (dashboard). Deep links work correctly.

**Summary:** Build → push to Git → Pages deploys. Add domain + env var; no extra cost beyond domain renewal.

**Updating the site (Cloudflare + Git)**

- Push to the branch connected to Pages (e.g. `main`): Cloudflare runs `npm run build` and deploys `dist/`. Updates are live in ~1–3 minutes.
- Env vars (e.g. `VITE_SOLANA_RPC`) are set in **Pages → Settings → Environment variables**; no need to change them for each deploy.
- See **CLOUDFLARE-DEPLOY-AND-FAQS.md** for more: coin deploy (local vs mainnet), bots, volume, legal.

---

## Summary

| Question | Answer |
|----------|--------|
| What is Open DEX / Swap? | The real DEX UI (swap + liquidity) in the React app loaded by `app.html`. |
| Why is it empty? | The React app isn’t built/served; the browser never gets the compiled JS. Run `npm run dev` or build and serve `dist/`. |
| Can you Git host? | Yes. Use GitHub Pages (build → push `dist/` or use Actions) or connect the repo to Vercel/Netlify. |
| “Buy website”? | Usually = buy a domain and/or pay for hosting. You can host for free (GitHub Pages, Vercel, Netlify, **Cloudflare Pages**) and only buy a domain if you want. **Production:** `kavachswap.com` on Cloudflare Pages — see §5 above. |

**Minimal steps to see the DEX and then host:**

1. `npm install` then `npm run dev` → open `http://localhost:5173/app.html` (no longer empty).  
2. `npm run build` → host the `dist/` folder (GitHub Pages, Vercel, Netlify, or your server).  
3. Optionally add a custom domain (e.g. point `kavach.1mantisshrimp.online` to that host).

---

## “File not found” / ERR_FILE_NOT_FOUND on swap page

**Cause:** The dashboard had a link **Open DEX (Swap / Liquidity)** with `href="/app.html"`. That absolute path breaks when:
- You open the dashboard as a **file** (e.g. double‑click `index.html`): the browser goes to `file:///app.html` (drive root) → file not found.
- The site is served from a **subpath** (e.g. `https://site.com/kavach/`): `/app.html` becomes `https://site.com/app.html` (wrong).

**Fix:** The link was changed to **`app.html`** (relative). From `index.html`, that loads `app.html` in the same folder. No extra page to create.

**In-app help:** The Swap tab now has a **?** button that toggles a short help text (how Swap works, Jupiter, Liquidity tab). It does **not** open another file or page.

**Test runner:** You do **not** need the test runner on the swap page. The Test Runner lives on the **dashboard** (index.html) only. The DEX (app.html) is for Swap, Liquidity, Pools, Token Factory, Launch — no test runner there.

---

## Empty swap page + “Phantom not found”

**Why the swap page is empty:** If you open **dist/app.html** (or index.html) by **double‑clicking** or via **file://**, the browser often can’t load the script (wrong path or security). So you get a blank page.

**Why “Phantom (or another Solana wallet) not found”:** Wallets like Phantom inject only on **http://** or **https://** origins (e.g. localhost or your domain). They do **not** inject on **file://**. So Connect Wallet never sees Phantom if you open the file directly.

**Fix (both):**

1. **Run a local server** — from the Kavach folder run:
   - **Dev:** `npm run dev` → open **http://localhost:5173/app.html** (DEX with Swap).
   - **Preview built site:** `npm run build` then `npm run preview` → open the URL it prints (e.g. http://localhost:4173/app.html).
2. **Install Phantom** from [phantom.app](https://phantom.app) if you haven’t.
3. **Open the app at that localhost (or hosted) URL** — do not open the HTML file directly from disk.

The app now uses **relative asset paths** (`base: "./"`) so the built `dist/` can be opened from disk for the UI, but **wallet connect will still only work when the app is served over http(s)** (e.g. localhost or your host). The DEX also shows a clear message when no wallet is detected, with these steps.

---

## Dashboards and docs

You have multiple dashboards in the project (e.g. **index.html** = main dashboard, **Kavach-3D-Enterprise-Dashboard.html**, and any under **6/dashh/3d** or **solana@6/dashh/3d**). The **Kavach DEX** (Swap, Liquidity, etc.) is the React app at **app.html**; the others are separate dashboard/overview pages. Use **npm run dev** and open the URL for whichever page you want (e.g. http://localhost:5173/ for index, http://localhost:5173/app.html for DEX).
