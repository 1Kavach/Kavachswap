/**
 * Token reader for swap UI: resolve mint → decimals and label.
 * No backend storage: list is built-in + on-chain getMint for paste. Optional localStorage for recent mints only.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { WSOL_MINT, KAVACH_MINT, DEVNET_TEST_SPL_MINT, KVS_DEVNET_MINT } from "./constants";
import { isDevnetBuild } from "./cluster";

export interface TokenInfo {
  mint: string;
  decimals: number;
  symbol: string;
  name?: string;
  /** True if from built-in list (SOL, KVH). Used for "verified" hint only. */
  fromList?: boolean;
}

const BUILT_IN: TokenInfo[] = [
  { mint: WSOL_MINT, decimals: 9, symbol: "SOL", name: "Wrapped SOL", fromList: true },
  { mint: KAVACH_MINT, decimals: 6, symbol: "KVH", name: "Kavach", fromList: true },
];

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { info: TokenInfo; cachedAt: number }>();

/** Built-in token list for dropdown (SOL, KVH; on devnet builds also devnet test SPL). */
export function getBuiltInTokens(): TokenInfo[] {
  const list = [...BUILT_IN];
  if (isDevnetBuild()) {
    list.push({
      mint: DEVNET_TEST_SPL_MINT,
      decimals: 9,
      symbol: "TEST",
      name: "Devnet test SPL",
      fromList: true,
    });
    list.push({
      mint: KVS_DEVNET_MINT,
      decimals: 6,
      symbol: "KVS",
      name: "Kavach Stable (devnet)",
      fromList: true,
    });
  }
  return list;
}

/** Get display label for a mint (symbol or short address). */
export function tokenLabel(info: TokenInfo | null): string {
  if (!info) return "—";
  if (info.symbol && info.symbol !== "Unknown") return info.symbol;
  return info.mint.slice(0, 4) + "…" + info.mint.slice(-4);
}

/**
 * Resolve mint address to decimals and label.
 * Uses built-in list first, then on-chain getMint. Caches result in memory.
 */
export async function getTokenInfo(
  connection: Connection,
  mintAddress: string
): Promise<TokenInfo | null> {
  const trimmed = mintAddress.trim();
  if (!trimmed) return null;

  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) return cached.info;
  if (cached) cache.delete(trimmed);

  const fromList = BUILT_IN.find((t) => t.mint === trimmed);
  if (fromList) {
    cache.set(trimmed, { info: fromList, cachedAt: Date.now() });
    return fromList;
  }

  try {
    const pk = new PublicKey(trimmed);
    const mint = await getMint(connection, pk);
    const info: TokenInfo = {
      mint: trimmed,
      decimals: mint.decimals,
      symbol: "Unknown",
      name: undefined,
      fromList: false,
    };
    cache.set(trimmed, { info, cachedAt: Date.now() });
    return info;
  } catch {
    return null;
  }
}

/**
 * Validate a pasted mint: readable on-chain and returns decimals.
 * Use this to show "Invalid or unreadable mint" when paste fails.
 */
export async function validateMint(
  connection: Connection,
  mintAddress: string
): Promise<{ valid: true; info: TokenInfo } | { valid: false; error: string }> {
  const trimmed = mintAddress.trim();
  if (!trimmed || trimmed.length < 32) {
    return { valid: false, error: "Invalid address length" };
  }
  let pk: PublicKey;
  try {
    pk = new PublicKey(trimmed);
  } catch {
    return { valid: false, error: "Invalid address format" };
  }
  try {
    const mint = await getMint(connection, pk);
    const info: TokenInfo = {
      mint: trimmed,
      decimals: mint.decimals,
      symbol: "Unknown",
      name: undefined,
      fromList: false,
    };
    cache.set(trimmed, { info, cachedAt: Date.now() });
    return { valid: true, info };
  } catch (e) {
    return {
      valid: false,
      error: "Mint not found or not an SPL token",
    };
  }
}

/** Optional: save recently used mint in localStorage for UX. */
const RECENT_MINTS_KEY = "kavach_recent_mints";
const MAX_RECENT = 10;

export function getRecentMints(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_MINTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function addRecentMint(mint: string): void {
  const recent = getRecentMints().filter((m) => m !== mint);
  recent.unshift(mint);
  try {
    localStorage.setItem(RECENT_MINTS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    /* ignore */
  }
}
