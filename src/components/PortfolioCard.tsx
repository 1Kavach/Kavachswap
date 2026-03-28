/**
 * Portfolio: SOL + SPL balances and trade history.
 */
import { useState, useEffect, useCallback } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { runWithRpcFallback } from "../lib/connection";
import { getPortfolioBalances, type PortfolioBalances } from "../lib/portfolio";
import { getTransactionHistory, type TxHistoryItem } from "../lib/history";

export default function PortfolioCard() {
  const { wallet, status } = useWalletConnection();
  const [balances, setBalances] = useState<PortfolioBalances | null>(null);
  const [history, setHistory] = useState<TxHistoryItem[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = wallet?.account?.address?.toString();

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) {
      setBalances(null);
      return;
    }
    setLoadingBalances(true);
    setError(null);
    try {
      const b = await runWithRpcFallback((conn) => getPortfolioBalances(conn, walletAddress));
      setBalances(b);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let friendly = msg;
      if (msg.includes("403") || msg.includes("Forbidden") || msg.toLowerCase().includes("access")) {
        friendly = "RPC access denied. Set VITE_SOLANA_RPC in .env (e.g. Helius or https://solana-rpc.publicnode.com) and refresh.";
      } else if (msg.includes("freetier") || msg.includes("paid tier") || msg.includes("method is not available")) {
        friendly = "This RPC doesn't support balance checks on free tier. Set VITE_SOLANA_RPC to a paid or public RPC (see 126/files/315.txt) and refresh.";
      }
      setError(friendly);
      setBalances(null);
    } finally {
      setLoadingBalances(false);
    }
  }, [walletAddress]);

  const fetchHistory = useCallback(async () => {
    if (!walletAddress) {
      setHistory([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const h = await runWithRpcFallback((conn) => getTransactionHistory(conn, walletAddress, 25));
      setHistory(h);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatDate = (blockTime: number | null) => {
    if (blockTime == null) return "—";
    const d = new Date(blockTime * 1000);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (status !== "connected" || !walletAddress) {
    return (
      <div
        className="rounded-2xl border-2 border-border-low bg-card p-6"
        style={{
          borderColor: "rgba(249,115,22,0.2)",
          borderBottomColor: "rgba(16,185,129,0.25)",
        }}
      >
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Briem Hand', cursive" }}>
          Portfolio & Trade History
        </h2>
        <p className="text-muted text-sm">
          Connect your wallet to see SOL and token balances and recent transactions.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border-2 border-border-low bg-card p-6 space-y-6"
      style={{
        borderColor: "rgba(249,115,22,0.2)",
        borderBottomColor: "rgba(16,185,129,0.25)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold" style={{ fontFamily: "'Briem Hand', cursive" }}>
          Portfolio & Trade History
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchBalances}
            disabled={loadingBalances}
            className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm font-medium text-green hover:bg-green-500/20 disabled:opacity-60"
          >
            {loadingBalances ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <p className="text-sm text-muted">
        Balances and recent activity load from RPC (with fallback).
      </p>

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-200">
          {error}
        </div>
      )}

      {/* Balances */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-2">Balances</h3>
        {loadingBalances && !balances ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : balances ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center rounded-lg bg-card border border-border-low px-4 py-3">
              <span className="font-medium">SOL</span>
              <span className="font-mono text-sm">{balances.sol.sol}</span>
            </div>
            {balances.tokens.length === 0 ? (
              <p className="text-sm text-muted">No SPL token balances.</p>
            ) : (
              balances.tokens.map((t) => (
                <div
                  key={t.mint}
                  className="flex justify-between items-center rounded-lg bg-card border border-border-low px-4 py-3"
                >
                  <span className="font-medium">{t.symbol}</span>
                  <span className="font-mono text-sm">{t.amount}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* Trade history */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-2">Recent activity</h3>
        {loadingHistory && history.length === 0 ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No recent transactions.</p>
        ) : (
          <ul className="space-y-1 max-h-80 overflow-y-auto">
            {history.map((tx) => (
              <li key={tx.signature} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-border-low last:border-0">
                <span className="text-muted truncate flex-1 font-mono" title={tx.signature}>
                  {tx.signature.slice(0, 8)}…{tx.signature.slice(-8)}
                </span>
                <span className="text-muted shrink-0">{formatDate(tx.blockTime)}</span>
                <a
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-orange hover:underline"
                >
                  View
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted">
        Balances and recent activity are read from the blockchain. Connect a wallet to view.
      </p>
    </div>
  );
}
