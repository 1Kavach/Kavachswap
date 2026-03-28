# Chart widgets — DEXTools & TradingView (with chart color palette)

Use this for **charts for coins** (pool/token price or crypto symbols). Not too much: one chart per pool or symbol is fine.

## Palette from 126/files/chart color.jpg (Solana DEX volume style)

Dark background, distinct protocol colors. Use for **header**, **chart background**, and **pane** so the widget matches the reference:

| Use            | Hex (no # for DEXTools) | Hex (with # for TradingView) |
|----------------|--------------------------|------------------------------|
| Dark background | `1a1a2e`                 | `#1a1a2e`                    |
| Chart/platform bg | `2d2d2d`              | `#2d2d2d`                    |
| Pane/controls   | `252530`                 | `#252530`                    |
| Header accent  | `7A2EFF` (Raydium purple) | `#7A2EFF`                  |
| Grid (subtle)  | `3d3d4d`                 | `rgba(61,61,77,0.3)`         |

Optional accents: teal `06b6d4`, Orca-style `00D4AA`.

---

## 1. DEXTools chart widget (Solana pool)

For **pool/token price chart** by pair address on Solana. Docs: [dextools-io/chart-widget](https://github.com/dextools-io/chart-widget).

**URL pattern (customize colors):**

```
https://www.dextools.io/widget-chart/en/solana/pe-light/<PAIR_ADDRESS>?theme=dark&chartType=2&chartResolution=30&drawingToolbars=false&headerColor=7A2EFF&tvPlatformColor=2d2d2d&tvPaneColor=252530
```

- **chainId:** `solana` (see repo for other chains).
- **pairAddress:** Your pool/pair address (e.g. from Pools tab or Solscan).
- **theme:** `dark` to match chart color reference.
- **headerColor, tvPlatformColor, tvPaneColor:** Hex **without** `#` (e.g. `7A2EFF`, `2d2d2d`, `252530`).
- **chartType:** 0=Bar, 1=Candle, 2=Line, 3=Area, etc.
- **chartResolution:** 1, 5, 15, 30, 60, 1D, 1W, etc.

**Iframe example:**

```html
<iframe
  title="DEXTools Trading Chart"
  width="100%"
  height="400"
  src="https://www.dextools.io/widget-chart/en/solana/pe-light/YOUR_PAIR_ADDRESS?theme=dark&chartType=2&chartResolution=30&drawingToolbars=false&headerColor=7A2EFF&tvPlatformColor=2d2d2d&tvPaneColor=252530">
</iframe>
```

**Note:** DEXTools iframe may not work from `localhost`; use a real domain (e.g. kavachswap.com) for testing.

---

## 2. TradingView advanced chart (crypto/symbol)

For a **symbol chart** (e.g. SOL/USD, BTC, or a stock). Uses [TradingView embed](https://www.tradingview.com/widget-docs/).

**Dark theme + chart color palette:** Use `theme: "dark"`, `backgroundColor: "#1a1a2e"`, `gridColor: "rgba(61,61,77,0.3)"`. Optional: `symbol` for crypto (e.g. `BINANCE:SOLUSDT`).

React component: `src/components/TradingViewWidget.tsx` (see below). You can pass `symbol` and optional `height`.

---

## 3. TradingView market summary (crypto)

Horizontal crypto market summary:

```html
<script type="module" src="https://widgets.tradingview-widget.com/w/en/tv-market-summary.js"></script>
<tv-market-summary direction="horizontal" assets-type="crypto"></tv-market-summary>
```

Add to a dashboard or a dedicated “Markets” section. Styling is controlled by TradingView; no custom chart colors in this snippet.

---

## How to get charts for YOUR pools (users see on site)

**Yes, it's possible.** Show one chart per pool and customize it for your DEX.

- **Pool address:** Use your pool's **PDA** (from `getPoolPda(mintA, mintB)`) as the DEXTools "pair address."
- **On site:** Add a chart on the **Pools** tab; when user selects a pair and pool exists, show the DEXTools iframe with that PDA.
- **Customize:** Use `theme=dark`, `headerColor=7A2EFF`, `tvPlatformColor=2d2d2d`, `tvPaneColor=252530` (or your hex). Change colors to match your DEX.
- **Data:** DEXTools only shows data for pairs they index. If Kavach isn't indexed yet, the iframe may show "no data" until you submit your DEX to DEXTools. You can still embed it (component below).
- **Full control:** If you have an indexer with OHLCV for your pools, build a custom chart (Chart.js / Lightweight Charts) and style it with your palette.

**Component:** `DEXToolsPoolChart` (in src/components) — pass `poolAddress` (PDA) and optional `height`; it builds the iframe URL with your colors.

## Where to use

- **DEX app (React):** Use **DEXToolsPoolChart** on the Pools tab with the selected pool's PDA. Use **TradingViewWidget** for “Chart” tab with a configurable symbol.
- **Dashboard (index.html):** Embed the same iframe URL or TradingView script; one chart per view.

All of the above is logged here and in the Protocol status log (soldexplex.md) when you add a chart to the live site.
