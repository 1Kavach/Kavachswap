/**
 * Add / Remove Liquidity — Kavach AMM. Pick pair → add or remove with correct logic, slippage, and UX.
 */
import { useState, useCallback, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { WSOL_MINT, KAVACH_MINT } from "../lib/constants";
import {
  getPoolStateForMints,
  getPoolPdaForMints,
  getPoolReserves,
  getLpSupply,
  getUserLpBalance,
  calculateWithdrawalAmounts,
  buildAddLiquidityIx,
  buildAddInitialLiquidityIx,
  buildRemoveLiquidityIx,
  humanPriceBPerAToRatio,
  computeAmountBRawForListingPrice,
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

const LP_DECIMALS = 9; // program uses 9 for LP mint
const SLIPPAGE_PERCENT_DEFAULT = 1;
const builtInTokens = getBuiltInTokens();

type LiquidityMode = "add" | "remove";

export default function LiquidityCard() {
  const { wallet, status } = useWalletConnection();
  const [mode, setMode] = useState<LiquidityMode>("add");
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
  const [lpSupply, setLpSupply] = useState<number>(0);
  const [userLpBalance, setUserLpBalance] = useState<number>(0);
  const [userTokenABalance, setUserTokenABalance] = useState<number>(0);
  const [userTokenBBalance, setUserTokenBBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  /** When LP supply is 0: human “Token B per 1 Token A” for first deposit (optional). */
  const [listingPriceBPerA, setListingPriceBPerA] = useState("");
  const [minLp, setMinLp] = useState("");
  const [removePercent, setRemovePercent] = useState(100);
  const [slippagePercent, setSlippagePercent] = useState(SLIPPAGE_PERCENT_DEFAULT);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<boolean | null>(null);
  const [isSending, setIsSending] = useState(false);

  const walletAddress = wallet?.account?.address?.toString();
  const userPubkey = walletAddress ? new PublicKey(walletAddress) : null;
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

  useEffect(() => {
    if (!poolState?.isInitialized || !userPubkey || !connection) {
      setLpSupply(0);
      setUserLpBalance(0);
      return;
    }
    let cancelled = false;
    Promise.all([
      getLpSupply(connection, poolState),
      getUserLpBalance(connection, poolState, userPubkey),
    ]).then(([supply, balance]) => {
      if (!cancelled) {
        setLpSupply(supply);
        setUserLpBalance(balance);
      }
    }).catch(() => {
      if (!cancelled) {
        setLpSupply(0);
        setUserLpBalance(0);
      }
    });
    return () => { cancelled = true; };
  }, [poolState, userPubkey, connection]);

  useEffect(() => {
    if (!userPubkey || !poolState?.isInitialized) {
      setUserTokenABalance(0);
      setUserTokenBBalance(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, userPubkey);
      const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, userPubkey);
      const [accA, accB] = await Promise.all([
        connection.getParsedAccountInfo(userTokenA),
        connection.getParsedAccountInfo(userTokenB),
      ]);
      if (cancelled) return;
      const balA = (accA.value?.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } | undefined)?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      const balB = (accB.value?.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } | undefined)?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      setUserTokenABalance(balA);
      setUserTokenBBalance(balB);
    })().catch(() => {
      if (!cancelled) {
        setUserTokenABalance(0);
        setUserTokenBBalance(0);
      }
    });
    return () => { cancelled = true; };
  }, [userPubkey, poolState, connection]);

  /** When first deposit: optional “B per A” price fills quote amount for preview (matches on-chain disc 5). */
  useEffect(() => {
    if (lpSupply !== 0 || !listingPriceBPerA.trim() || !amountA.trim()) return;
    try {
      const rawA = BigInt(Math.floor(parseFloat(amountA) * 10 ** decimalsA));
      if (rawA <= 0n) return;
      const { num, den } = humanPriceBPerAToRatio(listingPriceBPerA.trim());
      const rawB = computeAmountBRawForListingPrice(rawA, num, den, decimalsA, decimalsB);
      const ui = Number(rawB) / 10 ** decimalsB;
      setAmountB((n) => {
        const next = ui.toFixed(Math.min(decimalsB, 12)).replace(/\.?0+$/, "");
        return n === next ? n : next;
      });
    } catch {
      /* ignore parse errors while typing */
    }
  }, [amountA, listingPriceBPerA, lpSupply, decimalsA, decimalsB]);

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

  const decimalsA = infoA?.decimals ?? 9;
  const decimalsB = infoB?.decimals ?? 9;
  const poolPda = !sameMint && mintA && mintB ? getPoolPdaForMints(new PublicKey(mintA), new PublicKey(mintB)) : null;

  const handleAddLiquidity = useCallback(async () => {
    if (!userPubkey || !poolState?.isInitialized || !amountA || !poolPda) return;
    const rawA = Math.floor(parseFloat(amountA) * 10 ** decimalsA);
    if (rawA <= 0) return;

    const useInitialListing = lpSupply === 0 && listingPriceBPerA.trim().length > 0;
    if (!useInitialListing) {
      if (!amountB) return;
      const rawB = Math.floor(parseFloat(amountB) * 10 ** decimalsB);
      if (rawB <= 0) return;
    }

    try {
      setIsSending(true);
      setTxStatus("Building transaction...");
      setTxSuccess(null);

      const minLpTokens = minLp ? Math.floor(parseFloat(minLp) * 10 ** LP_DECIMALS) : 0;
      const ratio = listingPriceBPerA.trim() ? humanPriceBPerAToRatio(listingPriceBPerA.trim()) : null;
      const ix =
        useInitialListing && ratio
          ? buildAddInitialLiquidityIx({
              poolPda,
              poolState,
              user: userPubkey,
              amountA: rawA,
              priceNumerator: ratio.num,
              priceDenominator: ratio.den,
              minLpTokens,
            })
          : buildAddLiquidityIx({
              poolPda,
              poolState,
              user: userPubkey,
              amountA: rawA,
              amountB: Math.floor(parseFloat(amountB) * 10 ** decimalsB),
              minLpTokens,
            });

      const tx = new Transaction().add(ix);
      const walletPayload = {
        address: walletAddress!,
        features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
      };

      setTxStatus("Awaiting signature...");
      const sig = await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction: tx,
      });
      setTxStatus(`Liquidity added. ${sig.slice(0, 16)}...`);
      setTxSuccess(true);
      setAmountA("");
      setAmountB("");
      setListingPriceBPerA("");
      setMinLp("");
      const newState = await getPoolStateForMints(new PublicKey(mintA), new PublicKey(mintB));
      if (newState) setPoolState(newState);
      const r = newState ? await getPoolReserves(connection, newState) : null;
      if (r) setReserves(r);
    } catch (err) {
      console.error("Add liquidity failed:", err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      setTxSuccess(false);
    } finally {
      setIsSending(false);
    }
  }, [
    userPubkey,
    poolState,
    amountA,
    amountB,
    minLp,
    listingPriceBPerA,
    lpSupply,
    walletAddress,
    wallet,
    mintA,
    mintB,
    poolPda,
    decimalsA,
    decimalsB,
    connection,
  ]);

  const handleRemoveLiquidity = useCallback(async () => {
    if (!userPubkey || !poolState?.isInitialized || !poolPda || !reserves || lpSupply <= 0 || userLpBalance <= 0) return;
    const lpRaw = removePercent === 100
      ? userLpBalance
      : Math.floor((userLpBalance * removePercent) / 100);
    if (lpRaw <= 0) return;

    const { amountA: expectedA, amountB: expectedB } = calculateWithdrawalAmounts(
      lpRaw,
      reserves.reserveA,
      reserves.reserveB,
      lpSupply
    );
    const slip = slippagePercent / 100;
    const minAmountA = Math.floor(expectedA * (1 - slip));
    const minAmountB = Math.floor(expectedB * (1 - slip));

    try {
      setIsSending(true);
      setTxStatus("Building transaction...");
      setTxSuccess(null);

      const ixs: import("@solana/web3.js").TransactionInstruction[] = [];
      const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, userPubkey);
      const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, userPubkey);
      const [accA, accB] = await Promise.all([
        connection.getAccountInfo(userTokenA),
        connection.getAccountInfo(userTokenB),
      ]);
      if (!accA) {
        ixs.push(createAssociatedTokenAccountInstruction(
          userPubkey,
          userTokenA,
          userPubkey,
          poolState.tokenAMint
        ));
      }
      if (!accB) {
        ixs.push(createAssociatedTokenAccountInstruction(
          userPubkey,
          userTokenB,
          userPubkey,
          poolState.tokenBMint
        ));
      }

      ixs.push(buildRemoveLiquidityIx({
        poolPda,
        poolState,
        user: userPubkey,
        lpTokens: lpRaw,
        minAmountA,
        minAmountB,
      }));

      const tx = new Transaction().add(...ixs);
      const walletPayload = {
        address: walletAddress!,
        features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
      };

      setTxStatus("Awaiting signature...");
      const sig = await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction: tx,
      });
      setTxStatus(`Liquidity removed. ${sig.slice(0, 16)}...`);
      setTxSuccess(true);
      setRemovePercent(100);
      const newState = await getPoolStateForMints(new PublicKey(mintA), new PublicKey(mintB));
      if (newState) setPoolState(newState);
      const r = newState ? await getPoolReserves(connection, newState) : null;
      if (r) setReserves(r);
      const [newSupply, newBalance] = await Promise.all([
        newState ? getLpSupply(connection, newState) : 0,
        newState ? getUserLpBalance(connection, newState, userPubkey) : 0,
      ]);
      setLpSupply(newSupply);
      setUserLpBalance(newBalance);
    } catch (err) {
      console.error("Remove liquidity failed:", err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      setTxSuccess(false);
    } finally {
      setIsSending(false);
    }
  }, [userPubkey, poolState, poolPda, reserves, lpSupply, userLpBalance, removePercent, slippagePercent, walletAddress, wallet, mintA, mintB, connection]);

  const removeLpRaw = removePercent === 100 ? userLpBalance : Math.floor((userLpBalance * removePercent) / 100);
  const removePreview = reserves && lpSupply > 0 && removeLpRaw > 0
    ? calculateWithdrawalAmounts(removeLpRaw, reserves.reserveA, reserves.reserveB, lpSupply)
    : null;

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold">Liquidity (Kavach AMM)</p>
        <div className="flex rounded-lg border border-border-low bg-muted/10 p-0.5">
          <button
            type="button"
            onClick={() => { setMode("add"); setTxStatus(null); setTxSuccess(null); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "add" ? "bg-indigo-600 text-white" : "text-muted hover:text-foreground"}`}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setMode("remove"); setTxStatus(null); setTxSuccess(null); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "remove" ? "bg-indigo-600 text-white" : "text-muted hover:text-foreground"}`}
          >
            Remove
          </button>
        </div>
      </div>
      <p className="text-sm text-muted">
        Choose a pool by base/quote pair. Add liquidity to receive LP tokens; remove to burn LP and get tokens back.
      </p>
      {status !== "connected" && (
        <p className="text-xs text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          Connect wallet to load your LP balance and add or remove liquidity.
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

      {!loading && !sameMint && !poolState?.isInitialized && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-muted space-y-2">
          <p><strong className="text-foreground">No pool for this pair yet.</strong> Use the <strong className="text-foreground">Create Pool</strong> tab to create one, then this form will appear.</p>
          {poolPda && (
            <p className="text-xs">Pool PDA: <code className="break-all rounded bg-card px-1">{poolPda.toBase58()}</code></p>
          )}
        </div>
      )}

      {!loading && !sameMint && poolState?.isInitialized && poolState && (
        <>
          <div className="rounded-lg border border-border-low bg-muted/10 p-3 text-xs text-muted">
            Fee: {(poolState.feeNumerator / 100).toFixed(2)}% • Reserves: {tokenLabel(infoA)} {reserves?.reserveA != null ? (reserves.reserveA / 10 ** decimalsA).toFixed(4) : "—"} / {tokenLabel(infoB)} {reserves?.reserveB != null ? (reserves.reserveB / 10 ** decimalsB).toFixed(4) : "—"}
            {mode === "remove" && userLpBalance > 0 && (
              <span className="block mt-1 text-foreground">Your LP balance: {(userLpBalance / 10 ** LP_DECIMALS).toFixed(6)}</span>
            )}
          </div>

          {mode === "add" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Amount {tokenLabel(infoA)}</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="0.0"
                    value={amountA}
                    onChange={(e) => setAmountA(e.target.value)}
                    className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setAmountA(String(userTokenABalance))}
                    className="rounded-lg border border-border-low px-3 py-2 text-xs"
                  >
                    Max
                  </button>
                </div>
              </div>
              {lpSupply === 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Initial price ({tokenLabel(infoB)} per 1 {tokenLabel(infoA)}) — optional
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 0.05"
                    value={listingPriceBPerA}
                    onChange={(e) => setListingPriceBPerA(e.target.value)}
                    className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted">
                    First deposit only: if set, the program derives the quote amount from your base deposit and this ratio (same as CPAMM listing). Leave empty to enter both amounts manually.
                  </p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  Amount {tokenLabel(infoB)}
                  {lpSupply === 0 && listingPriceBPerA.trim() ? " (filled from initial price)" : ""}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="0.0"
                    value={amountB}
                    onChange={(e) => setAmountB(e.target.value)}
                    disabled={lpSupply === 0 && listingPriceBPerA.trim().length > 0}
                    className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setAmountB(String(userTokenBBalance))}
                    disabled={lpSupply === 0 && listingPriceBPerA.trim().length > 0}
                    className="rounded-lg border border-border-low px-3 py-2 text-xs disabled:opacity-50"
                  >
                    Max
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Min LP tokens (optional)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={minLp}
                  onChange={(e) => setMinLp(e.target.value)}
                  className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleAddLiquidity}
                disabled={
                  isSending ||
                  !amountA ||
                  parseFloat(amountA) <= 0 ||
                  (lpSupply === 0 && listingPriceBPerA.trim()
                    ? false
                    : !amountB || parseFloat(amountB) <= 0)
                }
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {isSending ? "Sending…" : "Add Liquidity"}
              </button>
            </div>
          )}

          {mode === "remove" && (
            <div className="space-y-3">
              {userLpBalance <= 0 ? (
                <p className="text-sm text-muted">You have no LP tokens in this pool. Add liquidity first.</p>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Remove (%)</label>
                    <div className="flex gap-2 flex-wrap">
                      {[25, 50, 75, 100].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setRemovePercent(p)}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium ${removePercent === p ? "bg-indigo-600 text-white border-indigo-600" : "border-border-low hover:bg-muted/20"}`}
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Slippage tolerance (%)</label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={slippagePercent}
                      onChange={(e) => setSlippagePercent(Math.max(0.1, parseFloat(e.target.value) || 0))}
                      className="w-full rounded-lg border border-border-low bg-background px-4 py-2.5 text-sm max-w-[120px]"
                    />
                  </div>
                  {removePreview && (
                    <div className="rounded-lg border border-border-low bg-muted/10 p-3 text-sm text-muted">
                      You will receive (before slippage): {tokenLabel(infoA)} {(removePreview.amountA / 10 ** decimalsA).toFixed(6)} / {tokenLabel(infoB)} {(removePreview.amountB / 10 ** decimalsB).toFixed(6)}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleRemoveLiquidity}
                    disabled={isSending || removeLpRaw <= 0}
                    className="w-full rounded-lg bg-orange px-4 py-2.5 text-sm font-medium text-white hover:bg-orange/90 disabled:opacity-50"
                  >
                    {isSending ? "Removing…" : `Remove ${removePercent}% Liquidity`}
                  </button>
                </>
              )}
            </div>
          )}

          {txStatus && (
            <p className={`text-sm ${txSuccess === true ? "text-green-600" : txSuccess === false ? "text-red-600" : "text-muted"}`}>
              {txStatus}
            </p>
          )}
        </>
      )}
    </section>
  );
}
