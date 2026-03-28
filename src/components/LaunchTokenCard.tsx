/**
 * Launch Token — Use token from wallet, create pool + add liquidity in one tx.
 */
import { useState, useCallback, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { WSOL_MINT, PROTOCOL_TREASURY } from "../lib/constants";
import { getPoolCreationFeeLamports } from "../lib/creatorMints";
import {
  getBuiltInTokens,
  getTokenInfo,
  validateMint,
  tokenLabel,
  addRecentMint,
  type TokenInfo,
} from "../lib/tokenReader";
import {
  hasPoolForMints,
  getPoolPda,
  getPoolStateForMints,
  buildInitializePoolIx,
  buildAddLiquidityIx,
  CORE_FEE_TIERS_BPS,
  CORE_POOL_ACCOUNT_LEN,
  DEFAULT_FEE_TIER_BPS,
  type PoolState,
} from "../lib/ammCore";
import { getWalletMaxUiAmount } from "../lib/walletBalances";

const builtInTokens = getBuiltInTokens();

type LaunchMode = "wallet" | "create";

export default function LaunchTokenCard() {
  const { wallet, status } = useWalletConnection();
  const [mode, setMode] = useState<LaunchMode>("wallet");
  const [mintInput, setMintInput] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [tokenMint, setTokenMint] = useState("");
  const [quoteMint, setQuoteMint] = useState(WSOL_MINT);
  const [tokenAmount, setTokenAmount] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [feeTierBps, setFeeTierBps] = useState(DEFAULT_FEE_TIER_BPS);
  const [poolExists, setPoolExists] = useState<boolean | null>(null);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [infoQuote, setInfoQuote] = useState<TokenInfo | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [mintRentLamports, setMintRentLamports] = useState<number>(0);
  const [tokenAccountRentLamports, setTokenAccountRentLamports] = useState<number>(0);
  const [poolAccountRentLamports, setPoolAccountRentLamports] = useState<number>(0);
  const [walletTokenBalance, setWalletTokenBalance] = useState<number>(0);
  const [walletQuoteBalance, setWalletQuoteBalance] = useState<number>(0);
  const [lastTxSig, setLastTxSig] = useState("");
  const [lastPoolAddress, setLastPoolAddress] = useState("");
  const [lastLpMintAddress, setLastLpMintAddress] = useState("");
  const connection = getConnection();
  const walletAddress = wallet?.account?.address?.toString();
  const userPubkey = walletAddress ? new PublicKey(walletAddress) : null;

  useEffect(() => {
    if (!tokenMint) { setInfo(null); return; }
    let c = false;
    getTokenInfo(connection, tokenMint).then((i) => { if (!c) setInfo(i ?? null); });
    return () => { c = true; };
  }, [tokenMint]);
  useEffect(() => {
    if (!quoteMint) { setInfoQuote(null); return; }
    let c = false;
    getTokenInfo(connection, quoteMint).then((i) => { if (!c) setInfoQuote(i ?? null); });
    return () => { c = true; };
  }, [quoteMint]);

  useEffect(() => {
    if (!tokenMint || !quoteMint || tokenMint === quoteMint) {
      setPoolExists(null);
      return;
    }
    let c = false;
    hasPoolForMints(new PublicKey(tokenMint), new PublicKey(quoteMint)).then((exists) => {
      if (!c) setPoolExists(exists);
    });
    return () => { c = true; };
  }, [tokenMint, quoteMint]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mintRent, tokenRent, poolRent] = await Promise.all([
          connection.getMinimumBalanceForRentExemption(82),
          connection.getMinimumBalanceForRentExemption(165),
          connection.getMinimumBalanceForRentExemption(CORE_POOL_ACCOUNT_LEN),
        ]);
        if (cancelled) return;
        setMintRentLamports(mintRent);
        setTokenAccountRentLamports(tokenRent);
        setPoolAccountRentLamports(poolRent);
      } catch {
        if (cancelled) return;
        setMintRentLamports(0);
        setTokenAccountRentLamports(0);
        setPoolAccountRentLamports(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(() => {
    if (!userPubkey || !tokenMint || !quoteMint) {
      setWalletTokenBalance(0);
      setWalletQuoteBalance(0);
      return;
    }
    let cancelled = false;
    const loadBalances = async () => {
      const [tokenBal, quoteBal] = await Promise.all([
        getWalletMaxUiAmount(connection, userPubkey, tokenMint),
        getWalletMaxUiAmount(connection, userPubkey, quoteMint),
      ]);
      if (cancelled) return;
      setWalletTokenBalance(tokenBal);
      setWalletQuoteBalance(quoteBal);
    };
    loadBalances().catch(() => {
      if (cancelled) return;
      setWalletTokenBalance(0);
      setWalletQuoteBalance(0);
    });
    return () => {
      cancelled = true;
    };
  }, [connection, userPubkey, tokenMint, quoteMint]);

  const handlePasteMint = useCallback(async () => {
    const raw = mintInput.trim();
    if (!raw) return;
    setPasteError(null);
    const result = await validateMint(connection, raw);
    if (result.valid) {
      setTokenMint(result.info.mint);
      setMintInput("");
      setShowPaste(false);
      addRecentMint(result.info.mint);
    } else {
      setPasteError(result.error);
    }
  }, [mintInput, connection]);

  const decimalsA = info?.decimals ?? 9;
  const decimalsB = infoQuote?.decimals ?? 9;
  const rawA = tokenAmount ? Math.floor(parseFloat(tokenAmount) * 10 ** decimalsA) : 0;
  const rawB = quoteAmount ? Math.floor(parseFloat(quoteAmount) * 10 ** decimalsB) : 0;
  const canLaunch = !!userPubkey && !!tokenMint && !!quoteMint && tokenMint !== quoteMint && rawA > 0 && rawB > 0;

  const handleLaunch = useCallback(async () => {
    if (!userPubkey || !tokenMint || !quoteMint || tokenMint === quoteMint || rawA <= 0 || rawB <= 0) return;
    const pkA = new PublicKey(tokenMint);
    const pkB = new PublicKey(quoteMint);

    try {
      setIsSending(true);
      setTxStatus("Building transaction...");
      setLastTxSig("");
      setLastPoolAddress("");
      setLastLpMintAddress("");

      const poolFeeLamports = getPoolCreationFeeLamports("core");
      const tx = new Transaction();
      const walletPayload = {
        address: userPubkey.toString(),
        features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
      };

      if (poolExists) {
        const poolState = await getPoolStateForMints(pkA, pkB);
        if (!poolState?.isInitialized) {
          setTxStatus("Pool not found. Please try again.");
          setIsSending(false);
          return;
        }
        const poolPda = getPoolPda(pkA, pkB)[0];
        const aIsUser = tokenMint === poolState.tokenAMint.toBase58();
        const amtA = aIsUser ? rawA : rawB;
        const amtB = aIsUser ? rawB : rawA;
        const userLpAta = getAssociatedTokenAddressSync(poolState.lpMint, userPubkey, false);
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(userPubkey, userLpAta, userPubkey, poolState.lpMint),
          buildAddLiquidityIx({
            poolPda,
            poolState,
            user: userPubkey,
            amountA: amtA,
            amountB: amtB,
            minLpTokens: 0,
          })
        );
      } else {
        const [mintA, mintB] = pkA.toBuffer().compare(pkB.toBuffer()) <= 0 ? [pkA, pkB] : [pkB, pkA];
        const vaultAKeypair = Keypair.generate();
        const vaultBKeypair = Keypair.generate();
        const lpMintKeypair = Keypair.generate();
        const { instruction: initIx, poolPda } = buildInitializePoolIx({
          mintA,
          mintB,
          feeTierBps,
          payer: userPubkey,
          protocolRecipient: new PublicKey(PROTOCOL_TREASURY),
          creatorRecipient: userPubkey,
          vaultAKeypair,
          vaultBKeypair,
          lpMintKeypair,
        });
        const poolState: PoolState = {
          isInitialized: true,
          bump: 0,
          tokenAMint: mintA,
          tokenBMint: mintB,
          tokenAVault: vaultAKeypair.publicKey,
          tokenBVault: vaultBKeypair.publicKey,
          lpMint: lpMintKeypair.publicKey,
          feeNumerator: feeTierBps,
          feeDenominator: 10_000,
          protocolFeeBps: 5000,
          creatorFeeBps: 5000,
        };
        const aIsUserToken = tokenMint === mintA.toBase58();
        const amountA = aIsUserToken ? rawA : rawB;
        const amountB = aIsUserToken ? rawB : rawA;
        const userLpAta = getAssociatedTokenAddressSync(poolState.lpMint, userPubkey, false);
        if (poolFeeLamports > 0) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: userPubkey,
              toPubkey: new PublicKey(PROTOCOL_TREASURY),
              lamports: poolFeeLamports,
            })
          );
        }
        tx.add(initIx);
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(userPubkey, userLpAta, userPubkey, poolState.lpMint),
          buildAddLiquidityIx({
            poolPda,
            poolState,
            user: userPubkey,
            amountA,
            amountB,
            minLpTokens: 0,
          })
        );
        const sigResult = await signAndSendTransaction({
          connection,
          wallet: walletPayload,
          transaction: tx,
          signers: [vaultAKeypair, vaultBKeypair, lpMintKeypair],
        });
        setTxStatus(`Launch complete! ${sigResult.slice(0, 16)}...`);
        setLastTxSig(sigResult);
        setLastPoolAddress(poolPda.toBase58());
        setLastLpMintAddress(poolState.lpMint.toBase58());
        setTokenAmount("");
        setQuoteAmount("");
        setPoolExists(true);
        setIsSending(false);
        return;
      }

      setTxStatus("Awaiting signature...");
      const sig = await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction: tx,
      });
      setTxStatus(`Launch complete! ${sig.slice(0, 16)}...`);
      const poolForPair = getPoolPda(pkA, pkB)[0].toBase58();
      setLastTxSig(sig);
      setLastPoolAddress(poolForPair);
      setTokenAmount("");
      setQuoteAmount("");
      if (!poolExists) setPoolExists(true);
    } catch (err) {
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setIsSending(false);
    }
  }, [userPubkey, tokenMint, quoteMint, rawA, rawB, feeTierBps, poolExists, connection, wallet]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Launch Token</p>
        <p className="text-sm text-muted">
          Use a token from your wallet or create a new one, then launch on Kavach AMM (create pool + add liquidity).
          Connect wallet first.
        </p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <p className="text-lg font-semibold">Launch Token with Kavach</p>
      <p className="text-sm text-muted">
        Launch your token on the Kavach AMM. Use an existing token from your wallet, pick a quote pair (e.g. SOL), add amounts — we create the pool + add liquidity in one tx.
      </p>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">Disclaimer</p>
        <p className="text-muted">
          Initial listing price is set by the amounts you deposit (token vs quote). Price can move with trading. This is not financial advice. You may lose value. Only use funds you can afford to lose. Kavach does not guarantee liquidity or volume.
        </p>
      </div>

      <div className="space-y-4">
        {!poolExists && tokenMint && quoteMint && tokenMint !== quoteMint && (
          <div className="rounded-lg border border-border-low bg-muted/20 p-3 text-sm">
            <p className="font-medium mb-2">Launch transaction split (new pool path)</p>
            <div className="space-y-1 text-muted">
              <div className="flex justify-between"><span>Protocol pool creation fee</span><span>{(getPoolCreationFeeLamports("core") / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>Pool account rent</span><span>{(poolAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>Vault A rent</span><span>{(tokenAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>Vault B rent</span><span>{(tokenAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>LP mint rent</span><span>{(mintRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="flex justify-between"><span>User LP ATA rent</span><span>{(tokenAccountRentLamports / 1e9).toFixed(9)} SOL</span></div>
              <div className="mt-2 flex justify-between font-medium text-foreground">
                <span>Total known (excludes network tx fee)</span>
                <span>{(
                  (getPoolCreationFeeLamports("core") +
                    poolAccountRentLamports +
                    tokenAccountRentLamports * 3 +
                    mintRentLamports) / 1e9
                ).toFixed(9)} SOL</span>
              </div>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted">How do you want to launch?</p>
          <div className="flex flex-wrap gap-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="launchMode"
                checked={mode === "wallet"}
                onChange={() => setMode("wallet")}
                className="rounded-full border-border-low"
              />
              <span className="text-sm">Use token from wallet</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="launchMode"
                checked={mode === "create"}
                onChange={() => setMode("create")}
                className="rounded-full border-border-low"
              />
              <span className="text-sm">Create new token</span>
            </label>
          </div>
        </div>

        {mode === "wallet" && (
          <div className="rounded-xl border border-border-low bg-muted/5 p-3">
            <label className="mb-1.5 block text-xs font-medium text-muted">Your token (mint)</label>
            <div className="flex gap-2 flex-wrap items-center">
              <select
                value={showPaste ? "__paste__" : tokenMint || "__"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__paste__") setShowPaste(true);
                  else if (v !== "__") {
                    setTokenMint(v);
                    setShowPaste(false);
                  }
                }}
                className="rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm min-w-[140px]"
              >
                <option value="__">Select or paste…</option>
                {builtInTokens.map((t) => (
                  <option key={t.mint} value={t.mint}>
                    {t.symbol}
                  </option>
                ))}
                {tokenMint && !builtInTokens.some((t) => t.mint === tokenMint) && (
                  <option value={tokenMint}>{tokenLabel(info)}</option>
                )}
                <option value="__paste__">Paste mint…</option>
              </select>
              {showPaste && (
                <div className="flex gap-2 flex-1 min-w-0">
                  <input
                    type="text"
                    placeholder="Mint address"
                    value={mintInput}
                    onChange={(e) => {
                      setMintInput(e.target.value);
                      setPasteError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handlePasteMint()}
                    className="flex-1 rounded-lg border border-border-low bg-background px-3 py-2 text-sm font-mono min-w-0"
                  />
                  <button
                    type="button"
                    onClick={handlePasteMint}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPaste(false);
                      setMintInput("");
                      setPasteError(null);
                    }}
                    className="rounded-lg border border-border-low px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {pasteError && <p className="mt-1 text-xs text-red-500">{pasteError}</p>}
          </div>
        )}

        {mode === "create" && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Create new token: go to <strong>Token Factory</strong> tab to create your token, then come back here and
              select &quot;Use token from wallet&quot; to launch it.
            </p>
            <p className="mt-1 text-xs text-muted">
              Single-tx &quot;create token + create pool + add liquidity&quot; will be available here soon.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Quote pair (pool partner)</label>
            <select
              value={quoteMint}
              onChange={(e) => setQuoteMint(e.target.value)}
              className="w-full rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
            >
              {builtInTokens.map((t) => (
                <option key={t.mint} value={t.mint}>{t.symbol}</option>
              ))}
            </select>
          </div>
          {mode === "wallet" && !poolExists && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Fee tier (new pool)</label>
              <select
                value={feeTierBps}
                onChange={(e) => setFeeTierBps(Number(e.target.value))}
                className="w-full rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
              >
                {CORE_FEE_TIERS_BPS.map((bps) => (
                  <option key={bps} value={bps}>{(bps / 100).toFixed(2)}%</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {mode === "wallet" && tokenMint && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Token amount</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="0"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(e.target.value)}
                  className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setTokenAmount(String(walletTokenBalance))}
                  className="rounded-lg border border-border-low px-3 py-2 text-xs"
                >
                  Max
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                {builtInTokens.find((t) => t.mint === quoteMint)?.symbol ?? "Quote"} amount
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="0"
                  value={quoteAmount}
                  onChange={(e) => setQuoteAmount(e.target.value)}
                  className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setQuoteAmount(String(walletQuoteBalance))}
                  className="rounded-lg border border-border-low px-3 py-2 text-xs"
                >
                  Max
                </button>
              </div>
            </div>
          </div>
        )}

        {poolExists === true && (
          <p className="text-xs text-muted">Pool exists — adding liquidity only.</p>
        )}
        {poolExists === false && (
          <p className="text-xs text-muted">No pool — creating pool + adding liquidity in one tx.</p>
        )}

        <button
          type="button"
          onClick={handleLaunch}
          disabled={isSending || !canLaunch}
          className="w-full rounded-lg bg-orange px-5 py-3 text-sm font-semibold text-white hover:bg-orange/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSending ? "Launching…" : "Launch"}
        </button>

        {txStatus && (
          <div className="rounded-lg border border-border-low bg-muted/30 px-3 py-2 text-sm">
            {txStatus}
          </div>
        )}
        {(lastTxSig || lastPoolAddress || lastLpMintAddress) && (
          <div className="rounded-lg border border-border-low bg-muted/20 p-3 text-xs space-y-2">
            {lastTxSig && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Transaction signature</span>
                <div className="flex items-center gap-2">
                  <code className="break-all">{lastTxSig}</code>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(lastTxSig)} className="rounded border px-2 py-1">Copy</button>
                </div>
              </div>
            )}
            {lastPoolAddress && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Pool address</span>
                <div className="flex items-center gap-2">
                  <code className="break-all">{lastPoolAddress}</code>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(lastPoolAddress)} className="rounded border px-2 py-1">Copy</button>
                </div>
              </div>
            )}
            {lastLpMintAddress && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">LP mint address</span>
                <div className="flex items-center gap-2">
                  <code className="break-all">{lastLpMintAddress}</code>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(lastLpMintAddress)} className="rounded border px-2 py-1">Copy</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
