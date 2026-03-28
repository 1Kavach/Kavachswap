/**
 * Airdrop + Checker — SPL token batch airdrop with verification.
 * Logic inspired by Helius AirShip, customized for Kavach (standard SPL, no ZK compression).
 */
import { useState, useCallback } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import {
  buildAirdropInstructions,
  MAX_RECIPIENTS_PER_TX,
} from "../lib/airdrop";
import { checkAddresses, type CheckResult } from "../lib/airdropChecker";
import {
  getBuiltInTokens,
  getTokenInfo,
  validateMint,
  tokenLabel,
  addRecentMint,
  type TokenInfo,
} from "../lib/tokenReader";

const builtInTokens = getBuiltInTokens();

function parseAddressList(text: string): string[] {
  return text
    .split(/[\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AirdropCard() {
  const { wallet, status } = useWalletConnection();
  const [mint, setMint] = useState("");
  const [mintInput, setMintInput] = useState("");
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [showPasteMint, setShowPasteMint] = useState(false);
  const [pasteMintError, setPasteMintError] = useState<string | null>(null);
  const [addressList, setAddressList] = useState("");
  const [amountPerRecipient, setAmountPerRecipient] = useState("");
  const [decimals, setDecimals] = useState(9);
  const [isSending, setIsSending] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [activeTab, setActiveTab] = useState<"airdrop" | "check">("airdrop");

  const connection = getConnection();
  const walletAddress = wallet?.account?.address?.toString();
  const sender = walletAddress ? new PublicKey(walletAddress) : null;

  const fetchTokenInfo = useCallback(async (m: string) => {
    if (!m) return;
    const i = await getTokenInfo(connection, m);
    setInfo(i ?? null);
    if (i) setDecimals(i.decimals);
  }, [connection]);

  const handlePasteMint = useCallback(async () => {
    const raw = mintInput.trim();
    if (!raw) return;
    setPasteMintError(null);
    const result = await validateMint(connection, raw);
    if (result.valid) {
      setMint(result.info.mint);
      setMintInput("");
      setShowPasteMint(false);
      addRecentMint(result.info.mint);
      fetchTokenInfo(result.info.mint);
    } else {
      setPasteMintError(result.error);
    }
  }, [mintInput, connection, fetchTokenInfo]);

  const handleMintSelect = (m: string) => {
    setMint(m);
    fetchTokenInfo(m);
  };

  const addresses = parseAddressList(addressList);
  const amountRaw = amountPerRecipient
    ? BigInt(Math.floor(parseFloat(amountPerRecipient) * 10 ** decimals))
    : 0n;

  const handleAirdrop = useCallback(async () => {
    if (!sender || !mint || addresses.length === 0 || amountRaw <= 0n) return;
    const pubkeys = addresses
      .map((a) => {
        try {
          return new PublicKey(a);
        } catch {
          return null;
        }
      })
      .filter((p): p is PublicKey => p != null);
    if (pubkeys.length === 0) {
      setTxStatus("No valid addresses");
      return;
    }

    const batches: PublicKey[][] = [];
    for (let i = 0; i < pubkeys.length; i += MAX_RECIPIENTS_PER_TX) {
      batches.push(pubkeys.slice(i, i + MAX_RECIPIENTS_PER_TX));
    }

    try {
      setIsSending(true);
      setTxStatus(`Sending ${pubkeys.length} recipients in ${batches.length} tx(s)...`);
      let sent = 0;
      for (let b = 0; b < batches.length; b++) {
        setTxStatus(`Batch ${b + 1}/${batches.length}...`);
        const instructions = await buildAirdropInstructions({
          connection,
          sender,
          mint: new PublicKey(mint),
          recipients: batches[b],
          amountPerRecipient: amountRaw,
        });
        const tx = new Transaction().add(...instructions);
        const walletPayload = {
          address: sender.toString(),
          features: (wallet as { features?: Record<string, unknown> })?.features ?? {},
        };
        await signAndSendTransaction({
          connection,
          wallet: walletPayload,
          transaction: tx,
        });
        sent += batches[b].length;
      }
      setTxStatus(`Airdrop complete: ${sent} recipients.`);
    } catch (err) {
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setIsSending(false);
    }
  }, [sender, mint, addresses, amountRaw, connection, wallet]);

  const handleCheck = useCallback(async () => {
    if (!mint || addresses.length === 0) return;
    const pubkeys = addresses
      .map((a) => {
        try {
          return new PublicKey(a);
        } catch {
          return null;
        }
      })
      .filter((p): p is PublicKey => p != null);
    if (pubkeys.length === 0) return;
    setIsChecking(true);
    setCheckResults(null);
    try {
      const results = await checkAddresses(
        connection,
        new PublicKey(mint),
        pubkeys,
        decimals
      );
      setCheckResults(results);
    } catch (err) {
      setCheckResults([{ address: "", received: false, error: String(err) }]);
    } finally {
      setIsChecking(false);
    }
  }, [mint, addresses, connection, decimals]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Airdrop & Checker</p>
        <p className="text-sm text-muted">Connect wallet to airdrop tokens or verify recipients.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <p className="text-lg font-semibold">Airdrop & Checker</p>
      <p className="text-sm text-muted">
        Batch SPL token airdrop (up to {MAX_RECIPIENTS_PER_TX} per tx). Verify who received tokens.
      </p>

      <div className="flex gap-2 border-b border-border-low pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("airdrop")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            activeTab === "airdrop" ? "bg-orange text-white" : "bg-muted/50 text-muted hover:bg-orange/20"
          }`}
        >
          Airdrop
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("check")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            activeTab === "check" ? "bg-orange text-white" : "bg-muted/50 text-muted hover:bg-orange/20"
          }`}
        >
          Check
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Token mint</label>
          <div className="flex gap-2">
            <select
              value={showPasteMint ? "__paste__" : mint || "__"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__paste__") setShowPasteMint(true);
                else if (v !== "__") handleMintSelect(v);
              }}
              className="rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm min-w-[140px]"
            >
              <option value="__">Select…</option>
              {builtInTokens.map((t) => (
                <option key={t.mint} value={t.mint}>{t.symbol}</option>
              ))}
              {mint && !builtInTokens.some((t) => t.mint === mint) && (
                <option value={mint}>{tokenLabel(info)}</option>
              )}
              <option value="__paste__">Paste mint…</option>
            </select>
            {showPasteMint && (
              <div className="flex flex-1 gap-2">
                <input
                  type="text"
                  placeholder="Mint address"
                  value={mintInput}
                  onChange={(e) => { setMintInput(e.target.value); setPasteMintError(null); }}
                  className="flex-1 rounded-lg border border-border-low px-3 py-2 text-sm font-mono"
                />
                <button onClick={handlePasteMint} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
                  Add
                </button>
                <button onClick={() => { setShowPasteMint(false); setMintInput(""); setPasteMintError(null); }} className="rounded-lg border px-3 py-2 text-sm">
                  Cancel
                </button>
              </div>
            )}
          </div>
          {pasteMintError && <p className="mt-1 text-xs text-red-500">{pasteMintError}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            Addresses (one per line or comma-separated)
          </label>
          <textarea
            value={addressList}
            onChange={(e) => setAddressList(e.target.value)}
            placeholder="Address1&#10;Address2&#10;..."
            rows={5}
            className="w-full rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-muted">{addresses.length} address(es)</p>
        </div>

        {activeTab === "airdrop" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Amount per recipient</label>
              <input
                type="text"
                placeholder="1000"
                value={amountPerRecipient}
                onChange={(e) => setAmountPerRecipient(e.target.value)}
                className="w-full rounded-lg border border-border-low bg-background px-3 py-2.5 text-sm"
              />
            </div>
            <button
              onClick={handleAirdrop}
              disabled={isSending || !mint || addresses.length === 0 || amountRaw <= 0n}
              className="w-full rounded-lg bg-orange px-5 py-3 text-sm font-semibold text-white hover:bg-orange/90 disabled:opacity-40"
            >
              {isSending ? "Sending…" : "Airdrop"}
            </button>
          </>
        )}

        {activeTab === "check" && (
          <>
            <button
              onClick={handleCheck}
              disabled={isChecking || !mint || addresses.length === 0}
              className="w-full rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {isChecking ? "Checking…" : "Check recipients"}
            </button>
            {checkResults && (
              <div className="max-h-64 overflow-auto rounded-lg border border-border-low">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-low bg-muted/20">
                      <th className="p-2 font-medium">Address</th>
                      <th className="p-2 font-medium">Received</th>
                      <th className="p-2 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkResults.map((r) => (
                      <tr key={r.address} className="border-b border-border-low/50">
                        <td className="p-2 font-mono text-xs">{r.address.slice(0, 8)}…{r.address.slice(-8)}</td>
                        <td className="p-2">{r.received ? "✓" : "—"}</td>
                        <td className="p-2">{r.amount ?? (r.error || "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {txStatus && (
          <div className="rounded-lg border border-border-low bg-muted/30 px-3 py-2 text-sm">
            {txStatus}
          </div>
        )}
      </div>
    </section>
  );
}
