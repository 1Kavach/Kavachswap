/**
 * Airdrop Checker — verify which addresses received a token.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

export interface CheckResult {
  address: string;
  received: boolean;
  amount?: string;
  decimals?: number;
  error?: string;
}

/**
 * Check a single address for token balance.
 */
export async function checkAddress(
  connection: Connection,
  mint: PublicKey,
  address: PublicKey,
  decimals: number = 9
): Promise<CheckResult> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, address, false);
    const acc = await getAccount(connection, ata);
    const amount = (Number(acc.amount) / 10 ** decimals).toFixed(decimals);
    return {
      address: address.toBase58(),
      received: true,
      amount,
      decimals,
    };
  } catch (e: unknown) {
    return {
      address: address.toBase58(),
      received: false,
      error: e instanceof Error ? e.message : "No token account",
    };
  }
}

/**
 * Check multiple addresses for token balance.
 */
export async function checkAddresses(
  connection: Connection,
  mint: PublicKey,
  addresses: PublicKey[],
  decimals: number = 9
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const addr of addresses) {
    results.push(await checkAddress(connection, mint, addr, decimals));
  }
  return results;
}
