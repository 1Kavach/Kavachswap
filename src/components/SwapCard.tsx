/**
 * Swap card — Kavach AMM primary (main swap UI). Jupiter in separate collapsible widget.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { WSOL_MINT, KAVACH_MINT, DEVNET_TEST_SPL_MINT } from "../lib/constants";
import { isDevnetBuild } from "../lib/cluster";
import {
  hasPoolForMints,
  getPoolStateForMints,
  getPoolPdaForMints,
  getPoolReserves,
  getKavachSwapQuote,
  buildSwapIx,
  type PoolState,
} from "../lib/ammCore";
import {
  getBuiltInTokens,
  getTokenInfo,
  validateMint,
  tokenLabel,
  addRecentMint,
  type TokenInfo,
} from "../lib/tokenReader";
import { Transaction } from "@solana/web3.js";
import JupiterSwapWidget from "./JupiterSwapWidget";
import { buildRouterCoreSwapIx, canUseRouterForCoreSwap } from "../lib/router";
import { getWalletMaxUiAmount } from "../lib/walletBalances";

const SWAP_HELP = (
  <div className="space-y-2 text-left text-sm text-muted">
    <p>
      <strong className="text-foreground">Kavach AMM</strong> — swap on pools you created or that exist on this cluster. From = spend; To = receive.
      On devnet, pick <strong className="text-foreground">TEST</strong> + SOL if you have a pool for that pair; Jupiter routes are often limited on devnet.
    </p>
  </div>
);

const SLIPPAGE_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "2%", bps: 200 },
  { label: "3%", bps: 300 },
];

const builtInTokens = getBuiltInTokens();

export default function SwapCard() {
  const { wallet, status } = useWalletConnection();
  const [mintA, setMintA] = useState(() =>
    isDevnetBuild() ? DEVNET_TEST_SPL_MINT : KAVACH_MINT,
  );
  const [mintB, setMintB] = useState(WSOL_MINT);
  const [infoA, setInfoA] = useState<TokenInfo | null>(null);
  const [infoB, setInfoB] = useState<TokenInfo | null>(null);
  const [showPasteA, setShowPasteA] = useState(false);
  const [showPasteB, setShowPasteB] = useState(false);
  const [pasteA, setPasteA] = useState("");
  const [pasteB, setPasteB] = useState("");
  const [pasteErrorA, setPasteErrorA] = useState<string | null>(null);
  const [pasteErrorB, setPasteErrorB] = useState<string | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [amountOut, setAmountOut] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [slippageCustom, setSlippageCustom] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<boolean | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showJupiter, setShowJupiter] = useState(false);
  const [kavachPoolState, setKavachPoolState] = useState<PoolState | null>(null);
  const [kavachReserves, setKavachReserves] = useState<{ reserveA: number; reserveB: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connection = getConnection();
  const routerEnabled = import.meta.env?.VITE_ENABLE_ROUTER === "1";

  // Resolve token info for mintA / mintB
  useEffect(() => {
    let cancelled = false;
    getTokenInfo(connection, mintA).then((info) => {
      if (!cancelled) setInfoA(info ?? null);
    });
    return () => { cancelled = true; };
  }, [mintA]);
  useEffect(() => {
    let cancelled = false;
    getTokenInfo(connection, mintB).then((info) => {
      if (!cancelled) setInfoB(info ?? null);
    });
    return () => { cancelled = true; };
  }, [mintB]);

  // Kavach pool for this pair (AMM first)
  useEffect(() => {
    if (mintA === mintB) {
      setKavachPoolState(null);
      setKavachReserves(null);
      return;
    }
    let cancelled = false;
    const pkA = new PublicKey(mintA);
    const pkB = new PublicKey(mintB);
    hasPoolForMints(pkA, pkB).then((exists) => {
      if (cancelled) return;
      if (!exists) {
        setKavachPoolState(null);
        setKavachReserves(null);
        return;
      }
      getPoolStateForMints(pkA, pkB).then((s) => {
        if (cancelled) return;
        setKavachPoolState(s ?? null);
        if (s) getPoolReserves(connection, s).then((r) => { if (!cancelled) setKavachReserves(r); });
        else setKavachReserves(null);
      });
    });
    return () => { cancelled = true; };
  }, [mintA, mintB]);

  const walletAddress = wallet?.account?.address?.toString();
  const decimalsIn = infoA?.decimals ?? 9;
  const decimalsOut = infoB?.decimals ?? 9;
  const sameMint = mintA === mintB;
  const kavachPoolAvailable = kavachPoolState != null;
  const customBps = slippageCustom !== "" ? Math.round(parseFloat(slippageCustom) * 100) : NaN;
  const effectiveSlippageBps = !Number.isNaN(customBps) && customBps >= 1 && customBps <= 5000 ? customBps : slippageBps;
  const slippagePct = effectiveSlippageBps / 100;
  const minReceived = kavachPoolAvailable && amountOut
    ? (parseFloat(amountOut) * (1 - effectiveSlippageBps / 10000)).toFixed(6)
    : null;

  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) <= 0 || sameMint) {
      setAmountOut("");
      return;
    }
    if (!kavachPoolState || !kavachReserves) {
      setAmountOut("");
      setQuoteLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuoteLoading(true);
    debounceRef.current = setTimeout(() => {
      const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decimalsIn);
      const aToB = kavachPoolState.tokenAMint.toBase58() === mintA;
      const reserveIn = aToB ? kavachReserves.reserveA : kavachReserves.reserveB;
      const reserveOut = aToB ? kavachReserves.reserveB : kavachReserves.reserveA;
      const { amountOut: out } = getKavachSwapQuote(
        amountRaw,
        reserveIn,
        reserveOut,
        kavachPoolState.feeNumerator,
        kavachPoolState.feeDenominator
      );
      setAmountOut(out > 0 ? (out / 10 ** decimalsOut).toFixed(6) : "");
      setQuoteLoading(false);
      debounceRef.current = null;
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amountIn, mintA, mintB, sameMint, decimalsIn, decimalsOut, kavachPoolState, kavachReserves]);

  const handleFlip = useCallback(() => {
    setMintA(mintB);
    setMintB(mintA);
    setAmountIn(amountOut);
    setAmountOut(amountIn);
  }, [mintB, mintA, amountOut, amountIn]);

  const handlePasteA = useCallback(async () => {
    if (!pasteA.trim()) return;
    setPasteErrorA(null);
    const result = await validateMint(connection, pasteA.trim());
    if (result.valid) {
      setMintA(result.info.mint);
      setPasteA("");
      setShowPasteA(false);
      addRecentMint(result.info.mint);
    } else {
      setPasteErrorA(result.error);
    }
  }, [pasteA, connection]);

  const handlePasteB = useCallback(async () => {
    if (!pasteB.trim()) return;
    setPasteErrorB(null);
    const result = await validateMint(connection, pasteB.trim());
    if (result.valid) {
      setMintB(result.info.mint);
      setPasteB("");
      setShowPasteB(false);
      addRecentMint(result.info.mint);
    } else {
      setPasteErrorB(result.error);
    }
  }, [pasteB, connection]);

  const handleSwap = useCallback(async () => {
    if (!walletAddress || !amountIn || parseFloat(amountIn) <= 0 || sameMint || !kavachPoolState) return;

    const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decimalsIn);
    const aToB = kavachPoolState.tokenAMint.toBase58() === mintA;
    const estimatedOut = amountOut ? Math.floor(parseFloat(amountOut) * 10 ** decimalsOut) : 0;
    const minOut = Math.floor(estimatedOut * (1 - effectiveSlippageBps / 10000));
    const poolPda = getPoolPdaForMints(new PublicKey(mintA), new PublicKey(mintB));
    const walletPayload = {
      address: walletAddress,
      features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
    };

    try {
      setIsSending(true);
      setTxStatus("Building swap…");
      setTxSuccess(null);

      let sig: string;
      const userPk = new PublicKey(walletAddress);
      const shouldTryRouter = routerEnabled && (await canUseRouterForCoreSwap());
      if (shouldTryRouter) {
        try {
          const routerIx = buildRouterCoreSwapIx({
            poolPda,
            poolState: kavachPoolState,
            user: userPk,
            amountIn: amountRaw,
            minAmountOut: minOut,
            aToB,
          });
          setTxStatus("Submitting optimized swap route…");
          sig = await signAndSendTransaction({
            connection,
            wallet: walletPayload,
            transaction: new Transaction().add(routerIx),
          });
        } catch (routerErr) {
          console.warn("Optimized route failed, falling back to direct Core AMM swap", routerErr);
          const directIx = buildSwapIx({
            poolPda,
            poolState: kavachPoolState,
            user: userPk,
            amountIn: amountRaw,
            minAmountOut: minOut,
            aToB,
          });
          setTxStatus("Optimized route unavailable, using direct swap…");
          sig = await signAndSendTransaction({
            connection,
            wallet: walletPayload,
            transaction: new Transaction().add(directIx),
          });
        }
      } else {
        const directIx = buildSwapIx({
          poolPda,
          poolState: kavachPoolState,
          user: userPk,
          amountIn: amountRaw,
          minAmountOut: minOut,
          aToB,
        });
        setTxStatus("Awaiting signature...");
        sig = await signAndSendTransaction({
          connection,
          wallet: walletPayload,
          transaction: new Transaction().add(directIx),
        });
      }
      setTxStatus(`Swap complete! ${sig.slice(0, 16)}...`);
      setTxSuccess(true);
      setAmountIn("");
      setAmountOut("");
    } catch (err) {
      console.error("Swap failed:", err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      setTxSuccess(false);
    } finally {
      setIsSending(false);
    }
  }, [walletAddress, amountIn, amountOut, mintA, mintB, sameMint, effectiveSlippageBps, decimalsOut, wallet, kavachPoolState, connection, routerEnabled]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Swap</p>
        <p className="text-sm text-muted">Connect wallet to swap. Kavach AMM first, Jupiter optional.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">Swap</p>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-low bg-muted/50 text-sm font-bold text-muted hover:bg-indigo-500/10 hover:text-indigo-400 hover:border-indigo-500/30 transition-colors"
          title="Help"
          aria-label="Help"
        >
          ?
        </button>
      </div>
      {showHelp && (
        <div className="rounded-xl border border-border-low bg-muted/20 p-4">
          {SWAP_HELP}
        </div>
      )}

      <div className="space-y-3">
        <div className="rounded-xl border border-border-low bg-muted/10 p-3">
          <label className="mb-1.5 block text-xs font-medium text-muted">From</label>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="number"
              placeholder="0.0"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 outline-none transition"
            />
            <button
              type="button"
              onClick={async () => {
                if (!walletAddress) return;
                try {
                  const owner = new PublicKey(walletAddress);
                  const max = await getWalletMaxUiAmount(connection, owner, mintA);
                  setAmountIn(String(max));
                } catch {
                  setAmountIn("0");
                }
              }}
              className="rounded-lg border border-border-low px-3 py-2 text-xs"
            >
              Max
            </button>
            <select
              value={showPasteA ? "__paste__" : mintA}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__paste__") setShowPasteA(true);
                else { setMintA(v); setShowPasteA(false); }
              }}
              className="rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm text-foreground focus:border-indigo-500/50 outline-none min-w-[140px]"
            >
              {builtInTokens.map((t) => (
                <option key={t.mint} value={t.mint}>{t.symbol}</option>
              ))}
              {!builtInTokens.some((t) => t.mint === mintA) && mintA && (
                <option value={mintA}>{tokenLabel(infoA)}</option>
              )}
              <option value="__paste__">Paste address…</option>
            </select>
          </div>
          {showPasteA && (
            <div className="mt-2 space-y-1">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Mint address"
                  value={pasteA}
                  onChange={(e) => { setPasteA(e.target.value); setPasteErrorA(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handlePasteA()}
                  className="flex-1 rounded-lg border border-border-low bg-background px-3 py-2 text-sm font-mono"
                />
                <button type="button" onClick={handlePasteA} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500">Add</button>
                <button type="button" onClick={() => { setShowPasteA(false); setPasteA(""); setPasteErrorA(null); }} className="rounded-lg border border-border-low px-3 py-2 text-sm">Cancel</button>
              </div>
              {pasteErrorA && <p className="text-xs text-red-500">{pasteErrorA}</p>}
              <p className="text-xs text-muted">Paste any SPL mint; we’ll read decimals from chain.</p>
            </div>
          )}
        </div>

        <div className="flex justify-center -my-1">
          <button
            type="button"
            onClick={handleFlip}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border-low bg-card text-muted hover:bg-indigo-500/15 hover:text-indigo-400 hover:border-indigo-500/30 transition-all hover:rotate-180 duration-300"
            aria-label="Flip tokens"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        <div className="rounded-xl border border-border-low bg-muted/10 p-3">
          <label className="mb-1.5 block text-xs font-medium text-muted">To (estimated)</label>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              placeholder="0.0"
              value={quoteLoading ? "…" : amountOut}
              readOnly
              className="flex-1 min-w-0 rounded-lg border border-border-low bg-background/60 px-4 py-2.5 text-sm text-foreground opacity-90"
            />
            <select
              value={showPasteB ? "__paste__" : mintB}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__paste__") setShowPasteB(true);
                else { setMintB(v); setShowPasteB(false); }
              }}
              className="rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm text-foreground focus:border-indigo-500/50 outline-none min-w-[140px]"
            >
              {builtInTokens.map((t) => (
                <option key={t.mint} value={t.mint}>{t.symbol}</option>
              ))}
              {!builtInTokens.some((t) => t.mint === mintB) && mintB && (
                <option value={mintB}>{tokenLabel(infoB)}</option>
              )}
              <option value="__paste__">Paste address…</option>
            </select>
          </div>
          {showPasteB && (
            <div className="mt-2 space-y-1">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Mint address"
                  value={pasteB}
                  onChange={(e) => { setPasteB(e.target.value); setPasteErrorB(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handlePasteB()}
                  className="flex-1 rounded-lg border border-border-low bg-background px-3 py-2 text-sm font-mono"
                />
                <button type="button" onClick={handlePasteB} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500">Add</button>
                <button type="button" onClick={() => { setShowPasteB(false); setPasteB(""); setPasteErrorB(null); }} className="rounded-lg border border-border-low px-3 py-2 text-sm">Cancel</button>
              </div>
              {pasteErrorB && <p className="text-xs text-red-500">{pasteErrorB}</p>}
              <p className="text-xs text-muted">Paste any SPL mint; we’ll read decimals from chain.</p>
            </div>
          )}
        </div>

        {sameMint && <p className="text-sm text-amber-500">Choose two different tokens.</p>}
        {!sameMint && !kavachPoolAvailable && mintA && mintB && (
          <p className="text-xs text-amber-600 dark:text-amber-400">No Kavach pool for this pair — use Jupiter below.</p>
        )}
        <div className="rounded-xl border border-border-low bg-muted/5 px-3 py-2.5 space-y-1.5 text-xs">
          {kavachPoolAvailable && (
            <div className="flex justify-between">
              <span className="text-muted">Route</span>
              <span className="font-medium">Kavach AMM</span>
            </div>
          )}
          {minReceived != null && (
            <div className="flex justify-between">
              <span className="text-muted">Min. received</span>
              <span>{minReceived} {tokenLabel(infoB)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted">Slippage tolerance</span>
            <span>{slippagePct}%</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-muted">Slippage</span>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {SLIPPAGE_PRESETS.map((opt) => (
                <button
                  key={opt.bps}
                  type="button"
                  onClick={() => { setSlippageBps(opt.bps); setSlippageCustom(""); }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    effectiveSlippageBps === opt.bps && slippageCustom === ""
                      ? "bg-indigo-600 text-white"
                      : "bg-muted/50 text-muted hover:bg-indigo-500/15 hover:text-indigo-400"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="Custom"
                value={slippageCustom}
                onChange={(e) => setSlippageCustom(e.target.value)}
                className="w-16 rounded-lg border border-border-low bg-background px-2 py-1 text-xs text-foreground focus:border-indigo-500/50 outline-none"
                min={0}
                max={50}
                step={0.1}
              />
              <span className="text-xs text-muted">%</span>
            </div>
          </div>
        </div>
        {slippagePct > 2 && (
          <p className="text-xs text-amber-500">High slippage ({slippagePct}%) — consider lowering for large trades.</p>
        )}

        <button
          onClick={handleSwap}
          disabled={
            isSending ||
            !amountIn ||
            parseFloat(amountIn) <= 0 ||
            sameMint ||
            quoteLoading ||
            !kavachPoolAvailable
          }
          className="w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {isSending ? "Swapping…" : quoteLoading ? "Getting quote…" : kavachPoolAvailable ? "Swap" : "No pool — use Jupiter below"}
        </button>

        {txStatus && (
          <div
            className={`rounded-lg px-3 py-2 text-sm transition-opacity duration-200 ${
              txSuccess === true ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : ""
            } ${
              txSuccess === false ? "bg-red-500/15 text-red-600 dark:text-red-400" : ""
            } ${
              txSuccess === null ? "bg-muted/50 text-muted" : ""
            }`}
          >
            {txStatus}
          </div>
        )}
      </div>

      <div className="border-t border-border-low pt-4">
        <button
          type="button"
          onClick={() => setShowJupiter((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
        >
          Jupiter (fallback, 20+ DEXes)
          <span className="text-muted">{showJupiter ? "▼" : "▶"}</span>
        </button>
        {showJupiter && (
          <div className="mt-3">
            <JupiterSwapWidget />
          </div>
        )}
      </div>
    </section>
  );
}
