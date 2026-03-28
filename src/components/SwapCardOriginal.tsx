/**
 * Backup / fallback Swap card — simple Jupiter swap (no price impact, route, or flip).
 * Use this if you need to switch back: in App.tsx change:
 *   import SwapCard from "./components/SwapCard";
 * to
 *   import SwapCard from "./components/SwapCardOriginal";
 */
import { useState, useCallback, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import {
  getJupiterQuote,
  getJupiterSwapTransaction,
  deserializeJupiterTx,
  effectiveJupiterPlatformFeeBps,
} from "../lib/swap";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { KNOWN_MINTS, TOKEN_DECIMALS } from "../lib/constants";

const SWAP_HELP = (
  <div className="space-y-2 text-left text-sm text-muted">
    <p><strong className="text-foreground">Swap</strong> uses Jupiter for best execution. Connect wallet, enter amount, choose From/To (KVH, SOL), set slippage, then click Swap. You sign in your wallet; no separate page.</p>
    <p>For Kavach native AMM pools (Create Pool / Add Liquidity), use the Liquidity tab once pools exist.</p>
  </div>
);

const SLIPPAGE_OPTIONS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "2%", bps: 200 },
  { label: "3%", bps: 300 },
];

function getDecimals(token: string): number {
  return TOKEN_DECIMALS[token] ?? 9;
}

export default function SwapCardOriginal() {
  const { wallet, status } = useWalletConnection();
  const [tokenA, setTokenA] = useState("KVH");
  const [tokenB, setTokenB] = useState("SOL");
  const [amountIn, setAmountIn] = useState("");
  const [amountOut, setAmountOut] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const walletAddress = wallet?.account?.address?.toString();
  const decimalsIn = getDecimals(tokenA);
  const decimalsOut = getDecimals(tokenB);
  const connection = getConnection();

  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) <= 0 || tokenA === tokenB) {
      setAmountOut("");
      return;
    }
    const mintA = KNOWN_MINTS[tokenA] || tokenA;
    const mintB = KNOWN_MINTS[tokenB] || tokenB;
    const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decimalsIn).toString();
    let cancelled = false;
    (async () => {
      try {
        const feeBps = await effectiveJupiterPlatformFeeBps(connection, mintB);
        const quote = await getJupiterQuote({
          inputMint: mintA,
          outputMint: mintB,
          amount: amountRaw,
          slippageBps,
          platformFeeBps: feeBps,
        });
        if (cancelled) return;
        if (!quote) {
          setAmountOut("");
          return;
        }
        setAmountOut((Number(quote.outAmount) / 10 ** decimalsOut).toFixed(6));
      } catch {
        if (!cancelled) setAmountOut("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amountIn, tokenA, tokenB, decimalsIn, decimalsOut, slippageBps, connection]);

  const handleSwap = useCallback(async () => {
    if (!walletAddress || !amountIn || parseFloat(amountIn) <= 0 || tokenA === tokenB)
      return;

    const mintA = KNOWN_MINTS[tokenA] || tokenA;
    const mintB = KNOWN_MINTS[tokenB] || tokenB;
    const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decimalsIn).toString();

    try {
      setIsSending(true);
      setTxStatus("Fetching route...");

      const connectionSwap = getConnection();
      const feeBps = await effectiveJupiterPlatformFeeBps(connectionSwap, mintB);
      const quote = await getJupiterQuote({
        inputMint: mintA,
        outputMint: mintB,
        amount: amountRaw,
        slippageBps,
        platformFeeBps: feeBps,
      });
      if (!quote) {
        setTxStatus("No route found");
        return;
      }

      setTxStatus("Building transaction...");
      const serialized = await getJupiterSwapTransaction({
        connection: connectionSwap,
        quote,
        userPublicKey: walletAddress,
        wrapAndUnwrapSol: true,
        platformFeeBps: feeBps,
      });
      if (!serialized) {
        setTxStatus("Failed to build swap tx");
        return;
      }

      const tx = deserializeJupiterTx(serialized);
      const walletPayload = {
        address: walletAddress,
        features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
      };

      setTxStatus("Awaiting signature...");
      const sig = await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction: tx,
      });
      setTxStatus(`Swap complete! ${sig.slice(0, 16)}...`);
      setAmountIn("");
      setAmountOut("");
    } catch (err) {
      console.error("Swap failed:", err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setIsSending(false);
    }
  }, [walletAddress, amountIn, tokenA, tokenB, slippageBps, decimalsIn, decimalsOut, wallet]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Swap</p>
        <p className="text-sm text-muted">Connect wallet to swap via Jupiter.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">Swap (Jupiter)</p>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-low bg-card text-sm font-bold text-muted hover:bg-cream/20 hover:text-foreground"
          title="Help"
          aria-label="Help"
        >
          ?
        </button>
      </div>
      {showHelp && (
        <div className="rounded-lg border border-border-low bg-cream/5 p-4">
          {SWAP_HELP}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted">From</label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="0.0"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              className="flex-1 rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm"
            />
            <select
              value={tokenA}
              onChange={(e) => setTokenA(e.target.value)}
              className="rounded-lg border border-border-low bg-card px-3 py-2.5 text-sm"
            >
              <option value="KVH">KVH</option>
              <option value="SOL">SOL</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">To (estimated)</label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="0.0"
              value={amountOut}
              readOnly
              className="flex-1 rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm opacity-80"
            />
            <select
              value={tokenB}
              onChange={(e) => setTokenB(e.target.value)}
              className="rounded-lg border border-border-low bg-card px-3 py-2.5 text-sm"
            >
              <option value="SOL">SOL</option>
              <option value="KVH">KVH</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Powered by Jupiter</p>
          <div className="flex gap-2">
            <span className="text-xs text-muted">Slippage:</span>
            <div className="flex gap-1">
              {SLIPPAGE_OPTIONS.map((opt) => (
                <button
                  key={opt.bps}
                  type="button"
                  onClick={() => setSlippageBps(opt.bps)}
                  className={`rounded px-2 py-0.5 text-xs ${
                    slippageBps === opt.bps
                      ? "bg-foreground text-background"
                      : "bg-card hover:bg-cream/20"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={handleSwap}
          disabled={
            isSending ||
            !amountIn ||
            parseFloat(amountIn) <= 0 ||
            tokenA === tokenB
          }
          className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-40"
        >
          {isSending ? "Swapping..." : "Swap"}
        </button>
        {txStatus && <p className="text-sm text-muted">{txStatus}</p>}
      </div>
    </section>
  );
}
