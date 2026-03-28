/**
 * Create Pool — Kavach Core AMM. Pick pair + fee tier, pay protocol fee, initialize pool.
 */
import { useState, useCallback, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import { WSOL_MINT, KAVACH_MINT, PROTOCOL_TREASURY } from "../lib/constants";
import { getPoolCreationFeeLamports } from "../lib/creatorMints";
import {
  buildInitializePoolIx,
  CORE_FEE_TIERS_BPS,
  DEFAULT_FEE_TIER_BPS,
} from "../lib/ammCore";
import {
  getBuiltInTokens,
  getTokenInfo,
  validateMint,
  tokenLabel,
  addRecentMint,
  type TokenInfo,
} from "../lib/tokenReader";

const builtInTokens = getBuiltInTokens();

export default function CreatePoolCard() {
  const { wallet, status } = useWalletConnection();
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
  const [feeTierBps, setFeeTierBps] = useState(DEFAULT_FEE_TIER_BPS);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<boolean | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [lastTxSig, setLastTxSig] = useState("");
  const [lastPoolAddress, setLastPoolAddress] = useState("");
  const [lastLpMintAddress, setLastLpMintAddress] = useState("");

  const walletAddress = wallet?.account?.address?.toString();
  const connection = getConnection();
  const sameMint = mintA === mintB;
  const poolFeeLamports = getPoolCreationFeeLamports("core");

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

  const handlePasteA = useCallback(async () => {
    if (!pasteA.trim()) return;
    setPasteErrorA(null);
    const result = await validateMint(connection, pasteA.trim());
    if (result.valid) {
      setMintA(result.info.mint);
      setPasteA("");
      setShowPasteA(false);
      addRecentMint(result.info.mint);
    } else setPasteErrorA(result.error);
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
    } else setPasteErrorB(result.error);
  }, [pasteB, connection]);

  const handleCreatePool = useCallback(async () => {
    if (!walletAddress || sameMint || !mintA || !mintB) return;

    const pkA = new PublicKey(mintA);
    const pkB = new PublicKey(mintB);
    const payer = new PublicKey(walletAddress);
    const vaultAKeypair = Keypair.generate();
    const vaultBKeypair = Keypair.generate();
    const lpMintKeypair = Keypair.generate();

    try {
      setIsSending(true);
      setTxStatus("Building transaction...");
      setTxSuccess(null);
      setLastTxSig("");
      setLastPoolAddress("");
      setLastLpMintAddress("");

      const { instruction, poolPda } = buildInitializePoolIx({
        mintA: pkA,
        mintB: pkB,
        feeTierBps,
        payer,
        protocolRecipient: new PublicKey(PROTOCOL_TREASURY),
        creatorRecipient: payer,
        vaultAKeypair,
        vaultBKeypair,
        lpMintKeypair,
      });

      const tx = new Transaction();
      if (poolFeeLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: new PublicKey(PROTOCOL_TREASURY),
            lamports: poolFeeLamports,
          })
        );
      }
      tx.add(instruction);

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
      setTxStatus(`Pool created. ${sig.slice(0, 16)}...`);
      setTxSuccess(true);
      setLastTxSig(sig);
      setLastPoolAddress(poolPda.toBase58());
      setLastLpMintAddress(lpMintKeypair.publicKey.toBase58());
    } catch (err) {
      console.error("Create pool failed:", err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      setTxSuccess(false);
    } finally {
      setIsSending(false);
    }
  }, [walletAddress, mintA, mintB, sameMint, feeTierBps, wallet, connection]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Create Pool</p>
        <p className="text-sm text-muted">Connect wallet to create a Kavach AMM pool for any token pair.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <p className="text-lg font-semibold">Create Pool (Kavach Core AMM)</p>
      <p className="text-sm text-muted">
        Create a new pool for a token pair. You pay rent + {poolFeeLamports / 1e9} SOL protocol fee. Then use <strong>Add Liquidity</strong> to seed it.
      </p>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted">
        <p className="font-medium text-foreground mb-0.5">Base vs Quote</p>
        <p>Base (Token A) is usually the reference asset (e.g. SOL or USDC). Quote (Token B) is the other token. Order does not change pool math; pick either way.</p>
      </div>

      <div className="space-y-3 rounded-xl border border-border-low bg-muted/10 p-3">
        <p className="text-xs font-medium text-muted">1. Base (Token A)</p>
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
        </div>
        {pasteErrorA && <p className="text-xs text-red-500">{pasteErrorA}</p>}
      </div>

      <div className="space-y-3 rounded-xl border border-border-low bg-muted/10 p-3">
        <p className="text-xs font-medium text-muted">2. Quote (Token B)</p>
        <div className="flex flex-wrap items-center gap-2">
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
        {pasteErrorB && <p className="text-xs text-red-500">{pasteErrorB}</p>}
        {sameMint && <p className="text-xs text-amber-500">Pick two different tokens.</p>}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted">3. Fee tier</label>
        <select
          value={feeTierBps}
          onChange={(e) => setFeeTierBps(Number(e.target.value))}
          className="rounded-lg border border-border-low bg-background px-3 py-2 text-sm"
        >
          {CORE_FEE_TIERS_BPS.map((bps) => (
            <option key={bps} value={bps}>{(bps / 100).toFixed(2)}%</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={handleCreatePool}
        disabled={isSending || sameMint}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {isSending ? "Creating…" : "Create Pool"}
      </button>

      {txStatus && (
        <p className={`text-sm ${txSuccess === true ? "text-green-600" : txSuccess === false ? "text-red-600" : "text-muted"}`}>
          {txStatus}
        </p>
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
    </section>
  );
}
