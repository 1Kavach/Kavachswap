/**
 * Jupiter swap — separate widget (optional fallback), not mixed with Kavach AMM.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey } from "@solana/web3.js";
import {
  getJupiterQuote,
  getJupiterSwapTransaction,
  deserializeJupiterTx,
  effectiveJupiterPlatformFeeBps,
  getJupiterPlatformFeeBps,
  type JupiterQuote,
} from "../lib/swap";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { WSOL_MINT } from "../lib/constants";
import {
  getBuiltInTokens,
  getTokenInfo,
  validateMint,
  tokenLabel,
  addRecentMint,
  type TokenInfo,
} from "../lib/tokenReader";
import { getWalletMaxUiAmount } from "../lib/walletBalances";

const SLIPPAGE_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "2%", bps: 200 },
  { label: "3%", bps: 300 },
];

function priceImpactColor(pct: number): string {
  if (Number.isNaN(pct) || pct <= 1) return "text-emerald-500";
  if (pct <= 3) return "text-amber-500";
  return "text-red-500";
}

const builtInTokens = getBuiltInTokens();

export default function JupiterSwapWidget() {
  const { wallet, status } = useWalletConnection();
  const [mintA, setMintA] = useState(WSOL_MINT);
  const [mintB, setMintB] = useState("");
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
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<boolean | null>(null);
  const [isSending, setIsSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connection = getConnection();

  useEffect(() => {
    let cancelled = false;
    getTokenInfo(connection, mintA).then((i) => { if (!cancelled) setInfoA(i ?? null); });
    return () => { cancelled = true; };
  }, [mintA]);
  useEffect(() => {
    if (!mintB) { setInfoB(null); return; }
    let cancelled = false;
    getTokenInfo(connection, mintB).then((i) => { if (!cancelled) setInfoB(i ?? null); });
    return () => { cancelled = true; };
  }, [mintB]);

  const decimalsIn = infoA?.decimals ?? 9;
  const decimalsOut = infoB?.decimals ?? 9;
  const sameMint = mintA === mintB && !!mintB;
  const customBps = slippageCustom !== "" ? Math.round(parseFloat(slippageCustom) * 100) : NaN;
  const effectiveSlippageBps = !Number.isNaN(customBps) && customBps >= 1 && customBps <= 5000 ? customBps : slippageBps;
  const priceImpactNum = quote?.priceImpactPct != null ? parseFloat(String(quote.priceImpactPct)) : NaN;
  const priceImpactPct = Number.isNaN(priceImpactNum) ? null : priceImpactNum;
  const minReceived =
    quote?.otherAmountThreshold != null && decimalsOut > 0
      ? (Number(quote.otherAmountThreshold) / 10 ** decimalsOut).toFixed(6)
      : null;

  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) <= 0 || sameMint || !mintB) {
      setQuote(null);
      setAmountOut("");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuoteLoading(true);
    debounceRef.current = setTimeout(() => {
      const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decimalsIn);
      (async () => {
        try {
          const feeBps = await effectiveJupiterPlatformFeeBps(connection, mintB);
          const q = await getJupiterQuote({
            inputMint: mintA,
            outputMint: mintB,
            amount: amountRaw.toString(),
            slippageBps: effectiveSlippageBps,
            platformFeeBps: feeBps,
          });
          setQuote(q ?? null);
          if (q) setAmountOut((Number(q.outAmount) / 10 ** decimalsOut).toFixed(6));
          else setAmountOut("");
        } catch {
          setQuote(null);
          setAmountOut("");
        } finally {
          setQuoteLoading(false);
          debounceRef.current = null;
        }
      })();
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [amountIn, mintA, mintB, sameMint, decimalsIn, decimalsOut, effectiveSlippageBps]);

  const handleFlip = useCallback(() => {
    setMintA(mintB);
    setMintB(mintA);
    setAmountIn(amountOut);
    setAmountOut(amountIn);
    setQuote(null);
  }, [mintB, mintA, amountOut, amountIn]);

  const handleSwap = useCallback(async () => {
    const walletAddress = wallet?.account?.address?.toString();
    if (!walletAddress || !amountIn || parseFloat(amountIn) <= 0 || sameMint || !mintB) return;

    const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decimalsIn);
    const walletPayload = {
      address: walletAddress,
      features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
    };

    try {
      setIsSending(true);
      setTxStatus("Fetching Jupiter route...");
      setTxSuccess(null);

      const feeBps = await effectiveJupiterPlatformFeeBps(connection, mintB);
      const q = await getJupiterQuote({
        inputMint: mintA,
        outputMint: mintB,
        amount: amountRaw.toString(),
        slippageBps: effectiveSlippageBps,
        platformFeeBps: feeBps,
      });
      if (!q) {
        setTxStatus("No Jupiter route found for this pair");
        setTxSuccess(false);
        setIsSending(false);
        return;
      }

      setTxStatus("Building transaction...");
      const serialized = await getJupiterSwapTransaction({
        connection,
        quote: q,
        userPublicKey: walletAddress,
        wrapAndUnwrapSol: true,
        platformFeeBps: feeBps,
      });
      if (!serialized) {
        setTxStatus("Failed to build swap tx");
        setTxSuccess(false);
        setIsSending(false);
        return;
      }

      const tx = deserializeJupiterTx(serialized);
      setTxStatus("Awaiting signature...");
      const sig = await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction: tx,
      });
      setTxStatus(`Swap complete! ${sig.slice(0, 16)}...`);
      setTxSuccess(true);
      setAmountIn("");
      setAmountOut("");
      setQuote(null);
    } catch (err) {
      console.error("Jupiter swap failed:", err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      setTxSuccess(false);
    } finally {
      setIsSending(false);
    }
  }, [wallet, amountIn, mintA, mintB, sameMint, decimalsIn, effectiveSlippageBps, connection]);

  const jupiterFeeBps = getJupiterPlatformFeeBps();

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

  if (status !== "connected") return null;

  return (
    <div className="space-y-3 rounded-xl border border-border-low border-amber-500/20 bg-muted/5 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 text-amber-600 dark:text-amber-400">
        <span className="text-sm font-semibold">Jupiter (fallback)</span>
        <span className="text-xs text-muted">20+ DEXes — mainnet-focused; devnet routes are often empty</span>
      </div>
      {jupiterFeeBps > 0 && (
        <p className="text-xs text-muted">
          Protocol fee: {jupiterFeeBps} bps ({(jupiterFeeBps / 100).toFixed(2)}%) of output to treasury — only when the output mint is SPL or Token-2022.
        </p>
      )}
      <div className="rounded-lg border border-border-low bg-muted/10 p-3">
        <label className="mb-1.5 block text-xs font-medium text-muted">From</label>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="number"
            placeholder="0.0"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-border-low bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={async () => {
              const walletAddress = wallet?.account?.address?.toString();
              if (!walletAddress) return;
              try {
                const owner = new PublicKey(walletAddress);
                const max = await getWalletMaxUiAmount(connection, owner, mintA, { includeNativeSolForWsol: true });
                setAmountIn(String(max));
              } catch {
                setAmountIn("0");
              }
            }}
            className="rounded-lg border border-border-low px-2 py-2 text-xs"
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
            className="rounded-lg border border-border-low bg-background px-2 py-2 text-sm min-w-[120px]"
          >
            {builtInTokens.map((t) => (
              <option key={t.mint} value={t.mint}>{t.symbol}</option>
            ))}
            {!builtInTokens.some((t) => t.mint === mintA) && mintA && (
              <option value={mintA}>{tokenLabel(infoA)}</option>
            )}
            <option value="__paste__">Paste…</option>
          </select>
        </div>
        {showPasteA && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              placeholder="Mint"
              value={pasteA}
              onChange={(e) => { setPasteA(e.target.value); setPasteErrorA(null); }}
              className="flex-1 rounded border px-2 py-1 text-sm font-mono"
            />
            <button type="button" onClick={handlePasteA} className="rounded bg-indigo-600 px-2 py-1 text-sm text-white">Add</button>
            <button type="button" onClick={() => { setShowPasteA(false); setPasteA(""); setPasteErrorA(null); }} className="rounded border px-2 py-1 text-sm">Cancel</button>
          </div>
        )}
        {pasteErrorA && <p className="mt-1 text-xs text-red-500">{pasteErrorA}</p>}
      </div>

      <div className="flex justify-center -my-1">
        <button
          type="button"
          onClick={handleFlip}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border-low bg-card text-muted hover:bg-amber-500/15 transition"
          aria-label="Flip"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      <div className="rounded-lg border border-border-low bg-muted/10 p-3">
        <label className="mb-1.5 block text-xs font-medium text-muted">To</label>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="text"
            placeholder="0.0"
            value={quoteLoading ? "…" : amountOut}
            readOnly
            className="flex-1 min-w-0 rounded-lg border border-border-low bg-background/60 px-3 py-2 text-sm opacity-90"
          />
          <select
            value={showPasteB ? "__paste__" : mintB || "__"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__paste__") setShowPasteB(true);
              else if (v !== "__") { setMintB(v); setShowPasteB(false); }
            }}
            className="rounded-lg border border-border-low bg-background px-2 py-2 text-sm min-w-[120px]"
          >
            <option value="__">Select…</option>
            {builtInTokens.map((t) => (
              <option key={t.mint} value={t.mint}>{t.symbol}</option>
            ))}
            {mintB && !builtInTokens.some((t) => t.mint === mintB) && (
              <option value={mintB}>{tokenLabel(infoB)}</option>
            )}
            <option value="__paste__">Paste…</option>
          </select>
        </div>
        {showPasteB && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              placeholder="Mint"
              value={pasteB}
              onChange={(e) => { setPasteB(e.target.value); setPasteErrorB(null); }}
              className="flex-1 rounded border px-2 py-1 text-sm font-mono"
            />
            <button type="button" onClick={handlePasteB} className="rounded bg-indigo-600 px-2 py-1 text-sm text-white">Add</button>
            <button type="button" onClick={() => { setShowPasteB(false); setPasteB(""); setPasteErrorB(null); }} className="rounded border px-2 py-1 text-sm">Cancel</button>
          </div>
        )}
        {pasteErrorB && <p className="mt-1 text-xs text-red-500">{pasteErrorB}</p>}
      </div>

      {!sameMint && (priceImpactPct != null || minReceived) && (
        <div className="space-y-1 text-xs">
          {priceImpactPct != null && (
            <div className="flex justify-between">
              <span className="text-muted">Price impact</span>
              <span className={priceImpactColor(priceImpactPct)}>{priceImpactPct.toFixed(2)}%</span>
            </div>
          )}
          {minReceived != null && (
            <div className="flex justify-between">
              <span className="text-muted">Min. received</span>
              <span>{minReceived} {tokenLabel(infoB)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted">Slippage</span>
        <div className="flex gap-1">
          {SLIPPAGE_PRESETS.map((opt) => (
            <button
              key={opt.bps}
              type="button"
              onClick={() => { setSlippageBps(opt.bps); setSlippageCustom(""); }}
              className={`rounded px-2 py-0.5 text-xs ${
                effectiveSlippageBps === opt.bps && slippageCustom === ""
                  ? "bg-indigo-600 text-white"
                  : "bg-muted/50 text-muted hover:bg-indigo-500/15"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleSwap}
        disabled={
          isSending ||
          !amountIn ||
          parseFloat(amountIn) <= 0 ||
          sameMint ||
          !mintB ||
          quoteLoading
        }
        className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40 disabled:pointer-events-none"
      >
        {isSending ? "Swapping…" : quoteLoading ? "Getting quote…" : "Swap via Jupiter"}
      </button>

      {txStatus && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            txSuccess === true ? "bg-emerald-500/15 text-emerald-600" : ""
          } ${
            txSuccess === false ? "bg-red-500/15 text-red-600" : ""
          } ${txSuccess === null ? "bg-muted/50 text-muted" : ""}`}
        >
          {txStatus}
        </div>
      )}
    </div>
  );
}
