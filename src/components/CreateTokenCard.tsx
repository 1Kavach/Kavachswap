import { useState, useCallback, useEffect, useMemo } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { buildCreateTokenInstructions } from "../lib/token";
import { buildCreateMetadataInstruction } from "../lib/metadata";
import { buildRevokeAuthorityInstructions, type RevokeOption } from "../lib/revoke";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import {
  PROTOCOL_TREASURY,
  TOKEN_CREATION_FEE_LAMPORTS,
  TOKEN_CREATION_FEE_BPS,
  TOKEN_CREATION_FEE_MIN_LAMPORTS,
  TOKEN_CREATION_FEE_MAX_LAMPORTS,
  REVOKE_MINT_FEE_LAMPORTS,
  REVOKE_FREEZE_FEE_LAMPORTS,
  REVOKE_UPDATE_FEE_LAMPORTS,
  REVOKE_ALL_AUTHORITIES_FEE_LAMPORTS,
} from "../lib/constants";

export default function CreateTokenCard() {
  const { wallet, status } = useWalletConnection();
  const [isSending, setIsSending] = useState(false);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [addMetadata, setAddMetadata] = useState(true);
  const [decimals, setDecimals] = useState("9");
  const [initialSupply, setInitialSupply] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [lastMintAddress, setLastMintAddress] = useState("");
  const [lastTxSig, setLastTxSig] = useState("");

  const [revokeMint, setRevokeMint] = useState("");
  const [revokeOption, setRevokeOption] = useState<RevokeOption>("all");
  const [revokeStatus, setRevokeStatus] = useState<string | null>(null);
  const [revokeSending, setRevokeSending] = useState(false);
  const [mintRentLamports, setMintRentLamports] = useState<number>(0);
  const [ataRentLamports, setAtaRentLamports] = useState<number>(0);
  const [metadataRentLamports, setMetadataRentLamports] = useState<number>(0);

  const walletAddress = wallet?.account?.address;
  const payer = walletAddress
    ? new PublicKey(
        typeof walletAddress === "string" ? walletAddress : (walletAddress as { toString(): string }).toString()
      )
    : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const connection = getConnection();
        const [mintRent, ataRent, metadataRent] = await Promise.all([
          connection.getMinimumBalanceForRentExemption(82),
          connection.getMinimumBalanceForRentExemption(165),
          connection.getMinimumBalanceForRentExemption(679), // Metaplex metadata account size
        ]);
        if (cancelled) return;
        setMintRentLamports(mintRent);
        setAtaRentLamports(ataRent);
        setMetadataRentLamports(metadataRent);
      } catch {
        if (cancelled) return;
        setMintRentLamports(0);
        setAtaRentLamports(0);
        setMetadataRentLamports(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const protocolFeeLamports = useMemo(() => {
    if (!PROTOCOL_TREASURY) return 0;
    if (TOKEN_CREATION_FEE_BPS > 0) {
      const totalRent = mintRentLamports + ataRentLamports;
      const feeFromBps = Math.floor((totalRent * TOKEN_CREATION_FEE_BPS) / 10_000);
      return Math.max(
        TOKEN_CREATION_FEE_MIN_LAMPORTS,
        Math.min(TOKEN_CREATION_FEE_MAX_LAMPORTS, feeFromBps)
      );
    }
    return TOKEN_CREATION_FEE_LAMPORTS;
  }, [mintRentLamports, ataRentLamports]);

  const totalKnownLamports =
    protocolFeeLamports +
    mintRentLamports +
    ataRentLamports +
    (addMetadata ? metadataRentLamports : 0);

  const handleCreateToken = useCallback(async () => {
    if (!payer || !name || !symbol || !initialSupply) return;

    const dec = parseInt(decimals, 10) || 9;
    const supplyRaw = BigInt(initialSupply) * BigInt(10 ** dec);
    const mintKeypair = Keypair.generate();
    const destination = payer;

    try {
      setIsSending(true);
      setTxStatus("Building transaction...");
      setLastMintAddress("");
      setLastTxSig("");

      const connection = getConnection();
      const createIxs = await buildCreateTokenInstructions({
        connection,
        payer,
        mintKeypair,
        decimals: dec,
        amount: supplyRaw,
        destination,
      });

      // Add Metaplex metadata if name, symbol, uri provided
      if (addMetadata && name.trim() && symbol.trim() && uri.trim()) {
        createIxs.push(
          buildCreateMetadataInstruction({
            mint: mintKeypair.publicKey,
            mintAuthority: payer,
            payer,
            updateAuthority: payer,
            name: name.trim().slice(0, 32),
            symbol: symbol.trim().slice(0, 10),
            uri: uri.trim().slice(0, 200),
            sellerFeeBasisPoints: 0,
            isMutable: true,
          })
        );
      }

      const instructions =
        PROTOCOL_TREASURY && protocolFeeLamports > 0
          ? [
              SystemProgram.transfer({
                fromPubkey: payer,
                toPubkey: new PublicKey(PROTOCOL_TREASURY),
                lamports: protocolFeeLamports,
              }),
              ...createIxs,
            ]
          : createIxs;

      setTxStatus("Awaiting signature...");
      const transaction = new Transaction();
      transaction.add(...instructions);
      const walletPayload = {
        address: payer.toString(),
        features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
      };
      const sig = await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction,
        signers: [mintKeypair],
      });
      setLastTxSig(sig);
      setLastMintAddress(mintKeypair.publicKey.toBase58());

      setTxStatus(
        addMetadata && uri.trim()
          ? `Token created with metadata.`
          : `Token created.${!addMetadata || !uri.trim() ? " Add metadata later via Metaplex or revoke section." : ""}`
      );
      setName("");
      setSymbol("");
      setUri("");
      setInitialSupply("");
    } catch (err) {
      console.error("Create token failed:", err);
      setTxStatus(
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsSending(false);
    }
  }, [payer, name, symbol, uri, decimals, initialSupply, addMetadata, wallet]);

  const handleRevokeAuthorities = useCallback(async () => {
    if (!payer || !revokeMint.trim()) return;
    let mintPubkey: PublicKey;
    try {
      mintPubkey = new PublicKey(revokeMint.trim());
    } catch {
      setRevokeStatus("Invalid mint address");
      return;
    }
    try {
      setRevokeSending(true);
      setRevokeStatus("Building revoke transaction...");
      const { instructions } = buildRevokeAuthorityInstructions({
        mint: mintPubkey,
        currentAuthority: payer,
        revoke: revokeOption,
      });
      const transaction = new Transaction();
      transaction.add(...instructions);
      const connection = getConnection();
      const walletPayload = {
        address: payer.toString(),
        features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
      };
      await signAndSendTransaction({
        connection,
        wallet: walletPayload,
        transaction,
      });
      const feeLamports = revokeOption === "all"
        ? REVOKE_ALL_AUTHORITIES_FEE_LAMPORTS
        : revokeOption === "mint"
          ? REVOKE_MINT_FEE_LAMPORTS
          : revokeOption === "freeze"
            ? REVOKE_FREEZE_FEE_LAMPORTS
            : REVOKE_UPDATE_FEE_LAMPORTS;
      const feeSol = feeLamports / 1e9;
      setRevokeStatus(
        `Revoked ${revokeOption === "all" ? "mint + freeze + update" : revokeOption} authority. Fee ${feeSol} SOL sent to protocol.`
      );
      setRevokeMint("");
    } catch (err) {
      console.error("Revoke failed:", err);
      setRevokeStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setRevokeSending(false);
    }
  }, [payer, revokeMint, revokeOption, wallet]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Create Your Token</p>
          <p className="text-sm text-muted">Connect your wallet to create an SPL token.</p>
        </div>
        <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
          Wallet not connected
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Create Your Token</p>
          <p className="text-sm text-muted">
            Create an SPL token with initial supply to your wallet. Add metadata via Metaplex after creation.
          </p>
        </div>
        <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground/80">
          SPL only
        </span>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-border-low bg-muted/20 p-3 text-sm">
          <p className="font-medium mb-2">Transaction split (known before signature)</p>
          <div className="space-y-1 text-muted">
            <div className="flex justify-between"><span>Protocol fee</span><span>{(protocolFeeLamports / 1e9).toFixed(9)} SOL</span></div>
            <div className="flex justify-between"><span>Mint account rent</span><span>{(mintRentLamports / 1e9).toFixed(9)} SOL</span></div>
            <div className="flex justify-between"><span>Token account rent (ATA)</span><span>{(ataRentLamports / 1e9).toFixed(9)} SOL</span></div>
            {addMetadata && (
              <div className="flex justify-between"><span>Metadata account rent</span><span>{(metadataRentLamports / 1e9).toFixed(9)} SOL</span></div>
            )}
            <div className="mt-2 flex justify-between font-medium text-foreground">
              <span>Full price now (plus network tx fee)</span>
              <span>{(totalKnownLamports / 1e9).toFixed(9)} SOL</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Total known (rent + protocol fee)</span>
              <span>{(totalKnownLamports / 1e9).toFixed(9)} SOL</span>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Name</label>
          <input
            type="text"
            placeholder="My Token"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Symbol</label>
          <input
            type="text"
            placeholder="MTK"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
            <input
              type="checkbox"
              checked={addMetadata}
              onChange={(e) => setAddMetadata(e.target.checked)}
              disabled={isSending}
              className="rounded border-border-low"
            />
            Add Metaplex metadata (name, symbol, image URI)
          </label>
          <input
            type="text"
            placeholder="https://ipfs.io/ipfs/... or image URL"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            disabled={isSending || !addMetadata}
            className="mt-1 w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
          {addMetadata && (
            <p className="mt-1 text-xs text-muted">
              Name & symbol above; URI points to JSON with image. Leave URI empty to skip metadata.
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Decimals</label>
            <input
              type="number"
              min="0"
              max="9"
              placeholder="9"
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              disabled={isSending}
              className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Initial supply</label>
            <input
              type="text"
              placeholder="1000000000"
              value={initialSupply}
              onChange={(e) => setInitialSupply(e.target.value)}
              disabled={isSending}
              className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
            />
          </div>
        </div>
        <button
          onClick={handleCreateToken}
          disabled={
            isSending ||
            !name ||
            !symbol ||
            !initialSupply ||
            BigInt(initialSupply || "0") <= 0n
          }
          className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSending ? "Creating..." : "Create Token"}
        </button>
      </div>

      {txStatus && (
        <div className="rounded-lg border border-border-low bg-cream/50 px-4 py-3 text-sm">
          {txStatus}
        </div>
      )}
      {(lastMintAddress || lastTxSig) && (
        <div className="rounded-lg border border-border-low bg-muted/20 p-3 text-xs space-y-2">
          {lastMintAddress && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">New token mint</span>
              <div className="flex items-center gap-2">
                <code className="break-all">{lastMintAddress}</code>
                <button type="button" onClick={() => void navigator.clipboard.writeText(lastMintAddress)} className="rounded border px-2 py-1">Copy</button>
              </div>
            </div>
          )}
          {lastTxSig && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Transaction signature</span>
              <div className="flex items-center gap-2">
                <code className="break-all">{lastTxSig}</code>
                <button type="button" onClick={() => void navigator.clipboard.writeText(lastTxSig)} className="rounded border px-2 py-1">Copy</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 border-t border-border-low pt-6">
        <p className="text-lg font-semibold">Revoke authorities</p>
        <p className="text-sm text-muted mt-1">
          Revoke mint, freeze, or metadata update authority (you must be current authority).
          Fee: update 0.006 SOL (cheapest), mint/freeze 0.01 SOL each, or 0.02 SOL for all 3 (bundle). Update = Metaplex metadata.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Token mint address</label>
            <input
              type="text"
              placeholder="Mint pubkey..."
              value={revokeMint}
              onChange={(e) => setRevokeMint(e.target.value)}
              disabled={revokeSending}
              className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm font-mono outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {(["mint", "freeze", "update", "all"] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="revokeOption"
                  checked={revokeOption === opt}
                  onChange={() => setRevokeOption(opt)}
                  disabled={revokeSending}
                  className="rounded-full border-border-low"
                />
                <span className="text-sm">
                  {opt === "all"
                    ? "All 3 (mint + freeze + update) — 0.02 SOL"
                    : opt === "update"
                      ? "update — 0.006 SOL"
                      : `${opt} — 0.01 SOL`}
                </span>
              </label>
            ))}
          </div>
          <button
            onClick={handleRevokeAuthorities}
            disabled={revokeSending || !revokeMint.trim()}
            className="rounded-lg bg-orange px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {revokeSending ? "Revoking..." : "Revoke"}
          </button>
        </div>
        {revokeStatus && (
          <div className="mt-2 rounded-lg border border-border-low bg-cream/50 px-3 py-2 text-sm">
            {revokeStatus}
          </div>
        )}
      </div>
    </section>
  );
}
