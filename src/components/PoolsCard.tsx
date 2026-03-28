/**
 * Pools — Look up any Kavach AMM pool by token pair (on-demand, no hardcoded pair).
 * One RPC per pair; default KVH/SOL for convenience.
 */
import { useState, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey } from "@solana/web3.js";
import { WSOL_MINT, KAVACH_MINT } from "../lib/constants";
import { getConnection } from "../lib/connection";
import {
  getPoolStateForMints,
  getPoolPdaForMints,
  getPoolReserves,
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
import DEXToolsPoolChart from "./DEXToolsPoolChart";

const builtInTokens = getBuiltInTokens();

export default function PoolsCard() {
  const { status } = useWalletConnection();
  const [mintA, setMintA] = useState(KAVACH_MINT);
  const [mintB, setMintB] = useState(WSOL_MINT);
  const [infoA, setInfoA] = useState<TokenInfo | null>(null);
  const [infoB, setInfoB] = useState<TokenInfo | null>(null);
  const [showPasteA, setShowPasteA] = useState(false);
  const [showPasteB, setShowPasteB] = useState(false);
  const [pasteA, setPasteA] = useState("");
  const [pasteB, setPasteB] = useState("");
  const [pasteErrorA, setPasteErrorA] = useState<string | null>(null);
  const [pasteErrorB, setPasteErrorB] = useState<string | null>(null);
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [reserves, setReserves] = useState<{ reserveA: number; reserveB: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const connection = getConnection();
  const sameMint = mintA === mintB;

  useEffect(() => {
    let cancelled = false;
    getTokenInfo(connection, mintA).then((info) => { if (!cancelled) setInfoA(info ?? null); });
    return () => { cancelled = true; };
  }, [mintA]);
  useEffect(() => {
    let cancelled = false;
    getTokenInfo(connection, mintB).then((info) => { if (!cancelled) setInfoB(info ?? null); });
    return () => { cancelled = true; };
  }, [mintB]);

  const POOL_FETCH_TIMEOUT_MS = 12_000;

  useEffect(() => {
    if (sameMint || !mintA || !mintB) {
      setPoolState(null);
      setReserves(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const pkA = new PublicKey(mintA);
    const pkB = new PublicKey(mintB);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), POOL_FETCH_TIMEOUT_MS)
    );
    Promise.race([getPoolStateForMints(pkA, pkB), timeoutPromise])
      .then((state) => {
        if (cancelled) return;
        setPoolState(state ?? null);
        if (state?.isInitialized) {
          return getPoolReserves(connection, state).then((r) => {
            if (!cancelled) setReserves(r);
          });
        }
        setReserves(null);
      })
      .catch(() => {
        if (!cancelled) {
          setPoolState(null);
          setReserves(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [mintA, mintB, sameMint, connection]);

  const handlePasteA = async () => {
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
  };
  const handlePasteB = async () => {
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
  };

  const decimalsA = infoA?.decimals ?? 9;
  const decimalsB = infoB?.decimals ?? 9;
  const poolPda = !sameMint && mintA && mintB ? getPoolPdaForMints(new PublicKey(mintA), new PublicKey(mintB)) : null;

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <p className="text-lg font-semibold">Kavach AMM Pools</p>
      <p className="text-sm text-muted">
        Look up any pool by base/quote pair. Data is live from chain. Create a pool in <strong>Create Pool</strong> if none exists yet.
      </p>
      {status !== "connected" && (
        <p className="text-xs text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          Connect wallet to add liquidity from the Add Liquidity tab; pool info below loads without wallet.
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-border-low bg-muted/10 p-3">
        <p className="text-xs font-medium text-muted">Base / Quote pair</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={showPasteA ? "__paste__" : mintA}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__paste__") setShowPasteA(true);
              else { setMintA(v); setShowPasteA(false); }
            }}
            className="rounded-lg border border-border-low bg-background px-3 py-2 text-sm min-w-[120px]"
          >
            {builtInTokens.map((t) => (
              <option key={t.mint} value={t.mint}>{t.symbol}</option>
            ))}
            {!builtInTokens.some((t) => t.mint === mintA) && mintA && (
              <option value={mintA}>{tokenLabel(infoA)}</option>
            )}
            <option value="__paste__">Paste mint…</option>
          </select>
          {showPasteA && (
            <span className="flex items-center gap-1 flex-wrap">
              <input
                type="text"
                placeholder="Mint A"
                value={pasteA}
                onChange={(e) => { setPasteA(e.target.value); setPasteErrorA(null); }}
                onKeyDown={(e) => e.key === "Enter" && handlePasteA()}
                className="w-48 rounded border border-border-low bg-background px-2 py-1.5 text-sm font-mono"
              />
              <button type="button" onClick={handlePasteA} className="rounded bg-indigo-600 px-2 py-1.5 text-sm text-white">Add</button>
              <button type="button" onClick={() => { setShowPasteA(false); setPasteA(""); setPasteErrorA(null); }} className="rounded border px-2 py-1.5 text-sm">Cancel</button>
            </span>
          )}
          <span className="text-muted">/</span>
          <select
            value={showPasteB ? "__paste__" : mintB}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__paste__") setShowPasteB(true);
              else { setMintB(v); setShowPasteB(false); }
            }}
            className="rounded-lg border border-border-low bg-background px-3 py-2 text-sm min-w-[120px]"
          >
            {builtInTokens.map((t) => (
              <option key={t.mint} value={t.mint}>{t.symbol}</option>
            ))}
            {!builtInTokens.some((t) => t.mint === mintB) && mintB && (
              <option value={mintB}>{tokenLabel(infoB)}</option>
            )}
            <option value="__paste__">Paste mint…</option>
          </select>
          {showPasteB && (
            <span className="flex items-center gap-1 flex-wrap">
              <input
                type="text"
                placeholder="Mint B"
                value={pasteB}
                onChange={(e) => { setPasteB(e.target.value); setPasteErrorB(null); }}
                onKeyDown={(e) => e.key === "Enter" && handlePasteB()}
                className="w-48 rounded border border-border-low bg-background px-2 py-1.5 text-sm font-mono"
              />
              <button type="button" onClick={handlePasteB} className="rounded bg-indigo-600 px-2 py-1.5 text-sm text-white">Add</button>
              <button type="button" onClick={() => { setShowPasteB(false); setPasteB(""); setPasteErrorB(null); }} className="rounded border px-2 py-1.5 text-sm">Cancel</button>
            </span>
          )}
        </div>
        {pasteErrorA && <p className="text-xs text-red-500">{pasteErrorA}</p>}
        {pasteErrorB && <p className="text-xs text-red-500">{pasteErrorB}</p>}
        {sameMint && <p className="text-xs text-amber-500">Pick two different tokens.</p>}
      </div>

      {loading && <p className="text-sm text-muted">Loading pool… (max 12s)</p>}

      {!loading && sameMint && mintA && mintB && (
        <p className="text-sm text-muted">Select two different tokens to view a pool.</p>
      )}

      {!loading && !sameMint && !poolState?.isInitialized && (
        <div className="rounded-lg border border-border-low bg-muted/10 p-4 text-sm text-muted space-y-1">
          <p><strong className="text-foreground">No pool for this pair.</strong> Use the <strong className="text-foreground">Create Pool</strong> tab to create one, then it will appear here.</p>
          {poolPda && (
            <p className="text-xs mt-2">Pool account (PDA): <code className="break-all rounded bg-card px-1">{poolPda.toBase58()}</code> — view on Solscan.</p>
          )}
        </div>
      )}

      {!loading && !sameMint && poolState?.isInitialized && poolState && (
        <div className="space-y-3 rounded-xl border border-border-low bg-muted/10 p-4">
          <p className="font-medium text-foreground">{tokenLabel(infoA)} / {tokenLabel(infoB)}</p>
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Pool address</dt>
              <dd className="truncate font-mono text-xs">
                {poolPda && (
                  <a
                    href={`https://solscan.io/account/${poolPda.toBase58()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:underline"
                  >
                    {poolPda.toBase58().slice(0, 8)}…{poolPda.toBase58().slice(-8)}
                  </a>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Fee</dt>
              <dd>{(poolState.feeNumerator / 100).toFixed(2)}%</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Reserve {tokenLabel(infoA)}</dt>
              <dd>{reserves != null ? (reserves.reserveA / 10 ** decimalsA).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Reserve {tokenLabel(infoB)}</dt>
              <dd>{reserves != null ? (reserves.reserveB / 10 ** decimalsB).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</dd>
            </div>
          </dl>
          {poolPda && (
            <div className="pt-3 border-t border-border-low">
              <p className="text-sm font-medium text-muted mb-2">Pool chart</p>
              <DEXToolsPoolChart poolAddress={poolPda.toBase58()} height={340} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
