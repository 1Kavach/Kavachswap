/**
 * Trade history for Portfolio: fetch recent transactions for a wallet.
 * Uses RPC getSignaturesForAddress (no API key). Optional: Helius parsed txs for labels.
 */
import { Connection, PublicKey } from "@solana/web3.js";

export interface TxHistoryItem {
  signature: string;
  blockTime: number | null;
  err: unknown;
  /** Explorer link (Solscan mainnet/devnet by default). */
  explorerUrl: string;
}

const DEFAULT_LIMIT = 20;
const SOLSCAN_MAINNET = "https://solscan.io/tx/";
const SOLSCAN_DEVNET = "https://solscan.io/tx/";

function getExplorerBase(rpcUrl: string): string {
  if (rpcUrl.includes("devnet") || rpcUrl.includes("127.0.0.1")) return SOLSCAN_DEVNET;
  return SOLSCAN_MAINNET;
}

/**
 * Fetch recent transaction signatures for an address.
 * Safe for Cloudflare; uses public RPC or your configured VITE_SOLANA_RPC.
 */
export async function getTransactionHistory(
  connection: Connection,
  walletAddress: string,
  limit: number = DEFAULT_LIMIT
): Promise<TxHistoryItem[]> {
  const pk = new PublicKey(walletAddress);
  const rpcUrl = (connection as unknown as { _rpcEndpoint?: string })._rpcEndpoint ?? "";
  const base = getExplorerBase(rpcUrl);

  const sigs = await connection.getSignaturesForAddress(pk, {
    limit,
  });

  return sigs.map((s): TxHistoryItem => ({
    signature: s.signature,
    blockTime: s.blockTime ?? null,
    err: s.err ?? null,
    explorerUrl: `${base}${s.signature}`,
  }));
}
