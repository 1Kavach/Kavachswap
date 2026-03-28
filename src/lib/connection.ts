/**
 * RPC connection with optional fallback list for reliability and rotation.
 * Primary: VITE_SOLANA_RPC. Fallbacks: VITE_SOLANA_RPC_FALLBACKS (comma-separated) or built-in public RPCs.
 * On 403 / rate limit / network errors, callers can use runWithRpcFallback to try the next endpoint.
 * For production: set VITE_SOLANA_RPC to your Helius (or preferred) URL — see 126/files/RPC-DEXTOOLS-SECURITY-VESTING.md.
 */
import { Connection } from "@solana/web3.js";

/** Default when `VITE_SOLANA_RPC` is unset — matches local dev / devnet testing (see .env.example). */
export const DEFAULT_SOLANA_RPC = "https://api.devnet.solana.com";

/** Public Solana RPCs (no API key). Used as fallbacks when `VITE_SOLANA_RPC_FALLBACKS` is unset. */
const PUBLIC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

/**
 * Primary RPC for wallet provider + `getConnection()`. Single source of truth.
 * Override with `VITE_SOLANA_RPC` (e.g. Helius mainnet in production).
 */
export function getSolanaRpcUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_SOLANA_RPC?.trim()) {
    return import.meta.env.VITE_SOLANA_RPC.trim();
  }
  return DEFAULT_SOLANA_RPC;
}

function getPrimaryRpc(): string {
  return getSolanaRpcUrl();
}

function getFallbackRpcs(): string[] {
  const env = typeof import.meta !== "undefined" && import.meta.env?.VITE_SOLANA_RPC_FALLBACKS
    ? import.meta.env.VITE_SOLANA_RPC_FALLBACKS
    : "";
  if (env) {
    return env.split(",").map((s: string) => s.trim()).filter(Boolean);
  }
  return PUBLIC_FALLBACKS;
}

/** Ordered list: primary first, then fallbacks. Use for rotation on failure. */
export function getRpcList(): string[] {
  const primary = getPrimaryRpc();
  const fallbacks = getFallbackRpcs();
  return [primary, ...fallbacks.filter((u) => u !== primary)];
}

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    const rpc = getPrimaryRpc();
    _connection = new Connection(rpc, { commitment: "confirmed" });
  }
  return _connection;
}

/** Create a Connection for a given RPC URL. */
export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, { commitment: "confirmed" });
}

/**
 * Run an async function that uses a Connection. On failure (e.g. 403, network),
 * try the next RPC in the list. Returns the first successful result or throws the last error.
 */
export async function runWithRpcFallback<T>(
  fn: (connection: Connection) => Promise<T>
): Promise<T> {
  const list = getRpcList();
  let lastError: unknown;
  for (const url of list) {
    try {
      const conn = createConnection(url);
      const result = await fn(conn);
      return result;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable =
        msg.includes("403") || msg.includes("Forbidden") || msg.includes("access") ||
        msg.includes("rate") || msg.includes("fetch") ||
        msg.includes("freetier") || msg.includes("method is not available") || msg.includes("paid tier") || msg.includes("code\":35");
      if (retryable) continue;
      throw e;
    }
  }
  throw lastError;
}
