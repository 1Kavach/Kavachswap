/**
 * Top LPs by current LP token balance for a pool.
 * Uses getTokenLargestAccounts on the pool's LP mint to build a leaderboard.
 */
import type { Connection, PublicKey } from "@solana/web3.js";

export interface TopLpEntry {
  /** Wallet public key (owner of the LP token account). */
  owner: string;
  /** Human-readable amount (e.g. "1.5"). */
  amount: string;
  /** Raw amount in smallest units. */
  amountRaw: bigint;
}

/**
 * Fetch top liquidity providers for a pool by LP mint.
 * @param connection Solana connection
 * @param lpMintPubkey Pool LP mint public key
 * @param limit Max number of entries (default 20)
 * @returns Sorted list of { owner, amount, amountRaw } (largest first)
 */
export async function getTopLps(
  connection: Connection,
  lpMintPubkey: PublicKey,
  limit = 20
): Promise<TopLpEntry[]> {
  const largest = await connection.getTokenLargestAccounts(lpMintPubkey);
  const byAmount = [...largest.value]
    .filter((a) => a.amount !== "0")
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0))
    .slice(0, limit);

  const entries: TopLpEntry[] = [];
  for (const acc of byAmount) {
    const parsed = await connection.getParsedAccountInfo(acc.address);
    let owner = acc.address.toBase58();
    if (parsed.value && "parsed" in parsed.value.data && (parsed.value.data as { parsed?: { info?: { owner?: string } } }).parsed?.info?.owner) {
      owner = (parsed.value.data as { parsed: { info: { owner: string } } }).parsed.info.owner;
    }
    entries.push({
      owner,
      amount: acc.uiAmountString ?? acc.amount,
      amountRaw: BigInt(acc.amount),
    });
  }
  return entries;
}
