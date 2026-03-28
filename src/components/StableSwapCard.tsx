import { useCallback, useEffect, useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { KVS_DEVNET_MINT, PROTOCOL_TREASURY, WSOL_MINT } from "../lib/constants";
import {
  addRecentMint,
  getBuiltInTokens,
  getTokenInfo,
  tokenLabel,
  type TokenInfo,
  validateMint,
} from "../lib/tokenReader";
import {
  buildStableInitializePoolIx,
  buildStableSwapIx,
  buildStableAddLiquidityIx,
  buildStableRemoveLiquidityIx,
  calculateStableWithdrawalAmounts,
  getMintTokenProgram,
  getStableLpSupply,
  getStablePoolPda,
  getStablePoolReserves,
  getStablePoolStateForMints,
  getStableSwapApproxQuote,
  getStableUserLpBalance,
  STABLE_DEFAULT_AMP,
  STABLE_DEFAULT_SWAP_FEE_BPS,
  type StablePoolState,
} from "../lib/ammStable";
import { getPoolCreationFeeLamports } from "../lib/creatorMints";

const builtInTokens = getBuiltInTokens();

export default function StableSwapCard() {
  const { wallet, status } = useWalletConnection();
  const connection = getConnection();
  const walletAddress = wallet?.account?.address?.toString();

  const [mintA, setMintA] = useState(KVS_DEVNET_MINT);
  const [mintB, setMintB] = useState(WSOL_MINT);
  const [infoA, setInfoA] = useState<TokenInfo | null>(null);
  const [infoB, setInfoB] = useState<TokenInfo | null>(null);
  const [poolState, setPoolState] = useState<StablePoolState | null>(null);
  const [reserves, setReserves] = useState<{ reserveA: number; reserveB: number } | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [amountOut, setAmountOut] = useState("");
  const [liqAmountA, setLiqAmountA] = useState("");
  const [liqAmountB, setLiqAmountB] = useState("");
  const [lpRemoveAmount, setLpRemoveAmount] = useState("");
  const [userLpBalanceRaw, setUserLpBalanceRaw] = useState(0);
  const [lpSupplyRaw, setLpSupplyRaw] = useState(0);
  const [lpDecimals, setLpDecimals] = useState(9);
  const [userTokenABalanceRaw, setUserTokenABalanceRaw] = useState(0);
  const [userTokenBBalanceRaw, setUserTokenBBalanceRaw] = useState(0);
  const [stableMode, setStableMode] = useState<"swap" | "liquidity">("swap");
  const [ampFactor, setAmpFactor] = useState(String(STABLE_DEFAULT_AMP));
  const [swapFeeBps, setSwapFeeBps] = useState(String(STABLE_DEFAULT_SWAP_FEE_BPS));
  const [slippagePct, setSlippagePct] = useState("1");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txOk, setTxOk] = useState<boolean | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [pasteMint, setPasteMint] = useState("");
  const [pasteTarget, setPasteTarget] = useState<"a" | "b" | null>(null);
  const [mintRentLamports, setMintRentLamports] = useState(0);
  const [tokenAccountRentLamports, setTokenAccountRentLamports] = useState(0);

  useEffect(() => {
    let c = false;
    getTokenInfo(connection, mintA).then((i) => { if (!c) setInfoA(i ?? null); });
    return () => { c = true; };
  }, [connection, mintA]);

  useEffect(() => {
    let c = false;
    getTokenInfo(connection, mintB).then((i) => { if (!c) setInfoB(i ?? null); });
    return () => { c = true; };
  }, [connection, mintB]);

  useEffect(() => {
    if (mintA === mintB) {
      setPoolState(null);
      setReserves(null);
      return;
    }
    let c = false;
    (async () => {
      const a = new PublicKey(mintA);
      const b = new PublicKey(mintB);
      const state = await getStablePoolStateForMints(a, b);
      if (c) return;
      setPoolState(state);
      if (!state) {
        setReserves(null);
        return;
      }
      const r = await getStablePoolReserves(state);
      if (c) return;
      setReserves(r);
      if (walletAddress) {
        const [userLp, lpSupply, lpMintParsed, tokenProgramA, tokenProgramB] = await Promise.all([
          getStableUserLpBalance(state, new PublicKey(walletAddress)),
          getStableLpSupply(state),
          connection.getParsedAccountInfo(state.lpMint),
          getMintTokenProgram(state.tokenAMint),
          getMintTokenProgram(state.tokenBMint),
        ]);
        const userPk = new PublicKey(walletAddress);
        const userAtaA = getAssociatedTokenAddressSync(state.tokenAMint, userPk, false, tokenProgramA);
        const userAtaB = getAssociatedTokenAddressSync(state.tokenBMint, userPk, false, tokenProgramB);
        const [accA, accB] = await Promise.all([
          connection.getParsedAccountInfo(userAtaA),
          connection.getParsedAccountInfo(userAtaB),
        ]);
        if (c) return;
        setUserLpBalanceRaw(userLp);
        setLpSupplyRaw(lpSupply);
        const lpParsed = lpMintParsed.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined;
        setLpDecimals(lpParsed?.parsed?.info?.decimals ?? 9);
        const balA =
          (accA.value?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | undefined)?.parsed?.info?.tokenAmount?.amount ?? "0";
        const balB =
          (accB.value?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | undefined)?.parsed?.info?.tokenAmount?.amount ?? "0";
        setUserTokenABalanceRaw(Number(balA));
        setUserTokenBBalanceRaw(Number(balB));
      } else {
        setUserLpBalanceRaw(0);
        setLpSupplyRaw(0);
        setLpDecimals(9);
        setUserTokenABalanceRaw(0);
        setUserTokenBBalanceRaw(0);
      }
    })();
    return () => { c = true; };
  }, [mintA, mintB, walletAddress, connection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mintRent, tokenRent] = await Promise.all([
          connection.getMinimumBalanceForRentExemption(82),
          connection.getMinimumBalanceForRentExemption(165),
        ]);
        if (cancelled) return;
        setMintRentLamports(mintRent);
        setTokenAccountRentLamports(tokenRent);
      } catch {
        if (cancelled) return;
        setMintRentLamports(0);
        setTokenAccountRentLamports(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(() => {
    if (!amountIn || !poolState || !reserves || mintA === mintB) {
      setAmountOut("");
      return;
    }
    const decIn = infoA?.decimals ?? 9;
    const decOut = infoB?.decimals ?? 9;
    const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decIn);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
      setAmountOut("");
      return;
    }
    const aToB = poolState.tokenAMint.toBase58() === mintA;
    const reserveIn = aToB ? reserves.reserveA : reserves.reserveB;
    const reserveOut = aToB ? reserves.reserveB : reserves.reserveA;
    const q = getStableSwapApproxQuote(amountRaw, reserveIn, reserveOut, poolState.swapFeeBps);
    setAmountOut(q.amountOut > 0 ? (q.amountOut / 10 ** decOut).toFixed(6) : "");
  }, [amountIn, poolState, reserves, mintA, mintB, infoA, infoB]);

  const onPasteMint = useCallback(async () => {
    if (!pasteTarget || !pasteMint.trim()) return;
    const v = await validateMint(connection, pasteMint.trim());
    if (!v.valid) {
      setTxStatus(v.error);
      setTxOk(false);
      return;
    }
    if (pasteTarget === "a") setMintA(v.info.mint);
    else setMintB(v.info.mint);
    addRecentMint(v.info.mint);
    setPasteMint("");
    setPasteTarget(null);
  }, [connection, pasteMint, pasteTarget]);

  const onSwap = useCallback(async () => {
    if (!walletAddress || !wallet || !poolState || !amountIn || !amountOut) return;
    try {
      setIsSending(true);
      setTxOk(null);
      setTxStatus("Building stable swap...");

      const user = new PublicKey(walletAddress);
      const decIn = infoA?.decimals ?? 9;
      const decOut = infoB?.decimals ?? 9;
      const amountRaw = Math.floor(parseFloat(amountIn) * 10 ** decIn);
      const estOutRaw = Math.floor(parseFloat(amountOut) * 10 ** decOut);
      const slip = Math.max(0, parseFloat(slippagePct) || 1);
      const minOut = Math.floor(estOutRaw * (1 - slip / 100));
      const aToB = poolState.tokenAMint.toBase58() === mintA;
      const [poolPda] = getStablePoolPda(new PublicKey(mintA), new PublicKey(mintB));

      const [tokenProgramA, tokenProgramB] = await Promise.all([
        getMintTokenProgram(poolState.tokenAMint),
        getMintTokenProgram(poolState.tokenBMint),
      ]);

      const ix = buildStableSwapIx({
        poolPda,
        poolState,
        user,
        amountIn: amountRaw,
        minAmountOut: minOut,
        aToB,
        tokenProgramA,
        tokenProgramB,
      });

      setTxStatus("Awaiting signature...");
      const sig = await signAndSendTransaction({
        connection,
        wallet: {
          address: walletAddress,
          features: (wallet as { features?: Record<string, unknown> }).features ?? {},
        },
        transaction: new Transaction().add(ix),
      });
      setTxStatus(`Stable swap complete: ${sig.slice(0, 16)}...`);
      setTxOk(true);
      setAmountIn("");
      setAmountOut("");
    } catch (e) {
      console.error("Stable swap failed", e);
      setTxStatus(`Stable swap failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setTxOk(false);
    } finally {
      setIsSending(false);
    }
  }, [walletAddress, wallet, poolState, amountIn, amountOut, infoA, infoB, slippagePct, mintA, mintB, connection]);

  const onAddLiquidity = useCallback(async () => {
    if (!walletAddress || !wallet || !liqAmountA || !liqAmountB) return;
    try {
      setIsSending(true);
      setTxOk(null);
      setTxStatus(poolState ? "Building stable add liquidity..." : "Building stable pool + add liquidity...");
      const user = new PublicKey(walletAddress);
      const mintAPk = new PublicKey(mintA);
      const mintBPk = new PublicKey(mintB);
      const [tokenProgramA, tokenProgramB] = await Promise.all([
        getMintTokenProgram(mintAPk),
        getMintTokenProgram(mintBPk),
      ]);
      const decA = infoA?.decimals ?? 9;
      const decB = infoB?.decimals ?? 9;
      const amountARaw = Math.floor(parseFloat(liqAmountA) * 10 ** decA);
      const amountBRaw = Math.floor(parseFloat(liqAmountB) * 10 ** decB);
      if (!Number.isFinite(amountARaw) || !Number.isFinite(amountBRaw) || amountARaw <= 0 || amountBRaw <= 0) {
        throw new Error("Enter valid liquidity amounts");
      }

      const tx = new Transaction();
      if (!poolState) {
        const vaultA = Keypair.generate();
        const vaultB = Keypair.generate();
        const lpMint = Keypair.generate();
        const init = buildStableInitializePoolIx({
          mintA: mintAPk,
          mintB: mintBPk,
          payer: user,
          protocolRecipient: new PublicKey(PROTOCOL_TREASURY),
          creatorRecipient: user,
          tokenProgramA,
          tokenProgramB,
          vaultAKeypair: vaultA,
          vaultBKeypair: vaultB,
          lpMintKeypair: lpMint,
          ampFactor: Math.max(10, parseInt(ampFactor, 10) || STABLE_DEFAULT_AMP),
          swapFeeBps: Math.max(1, parseInt(swapFeeBps, 10) || STABLE_DEFAULT_SWAP_FEE_BPS),
          protocolFeeBps: 5000,
          creatorFeeBps: 5000,
        });
        const [canonA, canonB] = mintAPk.toBuffer().compare(mintBPk.toBuffer()) <= 0 ? [mintAPk, mintBPk] : [mintBPk, mintAPk];
        const assumedPoolState: StablePoolState = {
          isInitialized: true,
          bump: 0,
          admin: user,
          tokenAMint: canonA,
          tokenBMint: canonB,
          tokenAVault: vaultA.publicKey,
          tokenBVault: vaultB.publicKey,
          lpMint: lpMint.publicKey,
          lpTokenProgram: tokenProgramA,
          ampFactor: Math.max(10, parseInt(ampFactor, 10) || STABLE_DEFAULT_AMP),
          swapFeeBps: Math.max(1, parseInt(swapFeeBps, 10) || STABLE_DEFAULT_SWAP_FEE_BPS),
          protocolFeeBps: 5000,
          creatorFeeBps: 5000,
          protocolFeeRecipient: new PublicKey(PROTOCOL_TREASURY),
          creatorFeeRecipient: user,
          tokenADecimals: canonA.equals(mintAPk) ? decA : decB,
          tokenBDecimals: canonA.equals(mintAPk) ? decB : decA,
        };
        const userLpAta = getAssociatedTokenAddressSync(
          assumedPoolState.lpMint,
          user,
          false,
          assumedPoolState.lpTokenProgram,
        );
        const stablePoolFeeLamports = getPoolCreationFeeLamports("stable");
        if (stablePoolFeeLamports > 0) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: user,
              toPubkey: new PublicKey(PROTOCOL_TREASURY),
              lamports: stablePoolFeeLamports,
            })
          );
        }
        tx.add(
          init.instruction,
          createAssociatedTokenAccountIdempotentInstruction(
            user,
            userLpAta,
            user,
            assumedPoolState.lpMint,
            assumedPoolState.lpTokenProgram,
          ),
          buildStableAddLiquidityIx({
            poolPda: init.poolPda,
            poolState: assumedPoolState,
            user,
            amountA: assumedPoolState.tokenAMint.equals(mintAPk) ? amountARaw : amountBRaw,
            amountB: assumedPoolState.tokenAMint.equals(mintAPk) ? amountBRaw : amountARaw,
            minLpTokens: 0,
            tokenProgramA,
            tokenProgramB,
          }),
        );
        const sig = await signAndSendTransaction({
          connection,
          wallet: {
            address: walletAddress,
            features: (wallet as { features?: Record<string, unknown> }).features ?? {},
          },
          transaction: tx,
          signers: [vaultA, vaultB, lpMint],
        });
        setTxStatus(`Create pool + add liquidity complete: ${sig.slice(0, 16)}...`);
      } else {
        const [poolPda] = getStablePoolPda(mintAPk, mintBPk);
        const userLpAta = getAssociatedTokenAddressSync(poolState.lpMint, user, false, poolState.lpTokenProgram);
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            user,
            userLpAta,
            user,
            poolState.lpMint,
            poolState.lpTokenProgram,
          ),
          buildStableAddLiquidityIx({
            poolPda,
            poolState,
            user,
            amountA: amountARaw,
            amountB: amountBRaw,
            minLpTokens: 0,
            tokenProgramA,
            tokenProgramB,
          }),
        );
        const sig = await signAndSendTransaction({
          connection,
          wallet: {
            address: walletAddress,
            features: (wallet as { features?: Record<string, unknown> }).features ?? {},
          },
          transaction: tx,
        });
        setTxStatus(`Add liquidity complete: ${sig.slice(0, 16)}...`);
      }
      setTxOk(true);
      setLiqAmountA("");
      setLiqAmountB("");
    } catch (e) {
      setTxStatus(`Add liquidity failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setTxOk(false);
    } finally {
      setIsSending(false);
    }
  }, [walletAddress, wallet, poolState, liqAmountA, liqAmountB, mintA, mintB, connection, infoA, infoB, ampFactor, swapFeeBps]);

  const onRemoveLiquidity = useCallback(async () => {
    if (!walletAddress || !wallet || !poolState || !reserves || !lpSupplyRaw || !lpRemoveAmount) return;
    try {
      setIsSending(true);
      setTxOk(null);
      setTxStatus("Building stable remove liquidity...");
      const user = new PublicKey(walletAddress);
      const [tokenProgramA, tokenProgramB] = await Promise.all([
        getMintTokenProgram(poolState.tokenAMint),
        getMintTokenProgram(poolState.tokenBMint),
      ]);
      const lpRaw = Math.floor(parseFloat(lpRemoveAmount) * 10 ** lpDecimals);
      if (!Number.isFinite(lpRaw) || lpRaw <= 0) throw new Error("Enter valid LP amount");
      const { amountA, amountB } = calculateStableWithdrawalAmounts(lpRaw, reserves.reserveA, reserves.reserveB, lpSupplyRaw);
      const [poolPda] = getStablePoolPda(new PublicKey(mintA), new PublicKey(mintB));
      const ix = buildStableRemoveLiquidityIx({
        poolPda,
        poolState,
        user,
        lpTokens: lpRaw,
        minAmountA: Math.floor(amountA * 0.99),
        minAmountB: Math.floor(amountB * 0.99),
        tokenProgramA,
        tokenProgramB,
      });
      const sig = await signAndSendTransaction({
        connection,
        wallet: {
          address: walletAddress,
          features: (wallet as { features?: Record<string, unknown> }).features ?? {},
        },
        transaction: new Transaction().add(ix),
      });
      setTxStatus(`Remove liquidity complete: ${sig.slice(0, 16)}...`);
      setTxOk(true);
      setLpRemoveAmount("");
    } catch (e) {
      setTxStatus(`Remove liquidity failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setTxOk(false);
    } finally {
      setIsSending(false);
    }
  }, [walletAddress, wallet, poolState, reserves, lpSupplyRaw, lpRemoveAmount, mintA, mintB, connection, lpDecimals]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-3 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Stable Swap</p>
        <p className="text-sm text-muted">Connect wallet to use KVS and other stable pools.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <p className="text-lg font-semibold">Stable AMM (KVS / stables)</p>
      <p className="text-sm text-muted">
        Dedicated stable module for KVS and stable pairs.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">From mint</label>
          <select
            value={mintA}
            onChange={(e) => setMintA(e.target.value)}
            className="w-full rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
          >
            {builtInTokens.map((t) => <option key={t.mint} value={t.mint}>{t.symbol}</option>)}
            {!builtInTokens.some((t) => t.mint === mintA) && <option value={mintA}>{tokenLabel(infoA)}</option>}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">To mint</label>
          <select
            value={mintB}
            onChange={(e) => setMintB(e.target.value)}
            className="w-full rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
          >
            {builtInTokens.map((t) => <option key={t.mint} value={t.mint}>{t.symbol}</option>)}
            {!builtInTokens.some((t) => t.mint === mintB) && <option value={mintB}>{tokenLabel(infoB)}</option>}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setPasteTarget("a")}>Paste From</button>
        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setPasteTarget("b")}>Paste To</button>
      </div>
      {pasteTarget && (
        <div className="flex gap-2">
          <input
            type="text"
            value={pasteMint}
            onChange={(e) => setPasteMint(e.target.value)}
            placeholder="Paste SPL mint"
            className="flex-1 rounded border border-border-low bg-background px-3 py-2 text-sm font-mono"
          />
          <button type="button" onClick={() => void onPasteMint()} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white">Add</button>
          <button type="button" onClick={() => setPasteTarget(null)} className="rounded border px-3 py-2 text-sm">Cancel</button>
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={() => setStableMode("swap")} className={`rounded px-3 py-1.5 text-sm ${stableMode === "swap" ? "bg-indigo-600 text-white" : "border border-border-low"}`}>Swap</button>
        <button type="button" onClick={() => setStableMode("liquidity")} className={`rounded px-3 py-1.5 text-sm ${stableMode === "liquidity" ? "bg-indigo-600 text-white" : "border border-border-low"}`}>Liquidity</button>
      </div>

      {stableMode === "swap" && (
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          type="number"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="Amount in"
          className="rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
        />
        <input
          type="text"
          readOnly
          value={amountOut}
          placeholder="Estimated out"
          className="rounded-lg border border-border-low bg-background/70 px-3 py-2.5 text-sm"
        />
        <input
          type="number"
          min={0}
          step={0.1}
          value={slippagePct}
          onChange={(e) => setSlippagePct(e.target.value)}
          placeholder="Slippage %"
          className="rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
        />
      </div>
      )}
      {stableMode === "swap" && (
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              if (!poolState || !walletAddress) return;
              const aToB = poolState.tokenAMint.toBase58() === mintA;
              const decIn = infoA?.decimals ?? 9;
              const raw = aToB ? userTokenABalanceRaw : userTokenBBalanceRaw;
              setAmountIn((raw / 10 ** decIn).toString());
            }}
            className="rounded border border-border-low px-2 py-1"
          >
            Max
          </button>
        </div>
      )}
      {stableMode === "swap" && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Quote shown here is approximate; final output is enforced by on-chain invariant and your slippage setting.
        </p>
      )}

      {!poolState && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No stable pool found for this mint pair on current cluster.
        </p>
      )}
      {poolState && (
        <p className="text-xs text-muted">
          Pool found. Amp: {poolState.ampFactor}, swap fee: {(poolState.swapFeeBps / 100).toFixed(2)}%
        </p>
      )}

      {stableMode === "swap" && (
      <button
        type="button"
        onClick={() => void onSwap()}
        disabled={isSending || !poolState || !amountIn || parseFloat(amountIn) <= 0}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {isSending ? "Swapping..." : "Swap on Stable AMM"}
      </button>
      )}

      {stableMode === "liquidity" && (
        <div className="space-y-3 rounded-lg border border-border-low bg-muted/10 p-3">
          <div className="text-xs text-muted">LP balance: {userLpBalanceRaw} (raw) • LP supply: {lpSupplyRaw} (raw) • LP decimals: {lpDecimals}</div>
          {!poolState && (
            <div className="rounded border border-border-low bg-background/60 p-2 text-xs text-muted">
              <div className="flex justify-between"><span>Protocol pool creation fee</span><span>{(getPoolCreationFeeLamports("stable") / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>Vault A rent</span><span>{(tokenAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>Vault B rent</span><span>{(tokenAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>LP mint rent</span><span>{(mintRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>User LP ATA rent</span><span>{(tokenAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="mt-1 flex justify-between font-medium text-foreground">
                <span>Full price now (plus network tx fee)</span>
                <span>{((getPoolCreationFeeLamports("stable") + mintRentLamports + tokenAccountRentLamports * 3) / 1e9).toFixed(9)} SOL</span>
              </div>
            </div>
          )}
          {!poolState && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="number" min={10} max={100000} value={ampFactor} onChange={(e) => setAmpFactor(e.target.value)} placeholder="Amp factor (e.g. 100)" className="rounded border border-border-low bg-background px-3 py-2 text-sm" />
              <input type="number" min={1} max={1000} value={swapFeeBps} onChange={(e) => setSwapFeeBps(e.target.value)} placeholder="Swap fee bps (e.g. 4)" className="rounded border border-border-low bg-background px-3 py-2 text-sm" />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <input type="number" value={liqAmountA} onChange={(e) => setLiqAmountA(e.target.value)} placeholder={`Add ${tokenLabel(infoA)}`} className="rounded border border-border-low bg-background px-3 py-2 text-sm" />
            <input type="number" value={liqAmountB} onChange={(e) => setLiqAmountB(e.target.value)} placeholder={`Add ${tokenLabel(infoB)}`} className="rounded border border-border-low bg-background px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setLiqAmountA((userTokenABalanceRaw / 10 ** (infoA?.decimals ?? 9)).toString())}
              className="rounded border border-border-low px-2 py-1"
            >
              Max {tokenLabel(infoA)}
            </button>
            <button
              type="button"
              onClick={() => setLiqAmountB((userTokenBBalanceRaw / 10 ** (infoB?.decimals ?? 9)).toString())}
              className="rounded border border-border-low px-2 py-1"
            >
              Max {tokenLabel(infoB)}
            </button>
          </div>
          <button type="button" onClick={() => void onAddLiquidity()} disabled={isSending} className="w-full rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{poolState ? "Add Liquidity" : "Create Pool + Add Liquidity"}</button>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input type="number" value={lpRemoveAmount} onChange={(e) => setLpRemoveAmount(e.target.value)} placeholder={`LP to remove (UI units, LP decimals ${lpDecimals})`} className="rounded border border-border-low bg-background px-3 py-2 text-sm" />
            <button type="button" onClick={() => void onRemoveLiquidity()} disabled={isSending || !poolState} className="rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Remove</button>
          </div>
          <button
            type="button"
            onClick={() => setLpRemoveAmount((userLpBalanceRaw / 10 ** lpDecimals).toString())}
            className="rounded border border-border-low px-2 py-1 text-xs"
          >
            Max LP
          </button>
        </div>
      )}

      {txStatus && (
        <div className={`rounded-lg px-3 py-2 text-sm ${
          txOk === true ? "bg-emerald-500/15 text-emerald-600" :
            txOk === false ? "bg-red-500/15 text-red-600" : "bg-muted/40 text-muted"
        }`}>
          {txStatus}
        </div>
      )}
    </section>
  );
}
