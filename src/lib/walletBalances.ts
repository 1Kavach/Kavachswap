import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { WSOL_MINT } from "./constants";

const SOL_GAS_BUFFER_LAMPORTS = 10_000_000; // 0.01 SOL

/**
 * Returns a spendable UI amount for the selected mint from wallet state.
 * - SPL / Token-2022: sums balances across all token accounts for this mint.
 * - WSOL mint: falls back to SOL balance minus a small tx-fee buffer.
 */
export async function getWalletMaxUiAmount(
  connection: Connection,
  owner: PublicKey,
  mint: string,
  options?: { includeNativeSolForWsol?: boolean }
): Promise<number> {
  if (mint === WSOL_MINT && options?.includeNativeSolForWsol) {
    const lamports = await connection.getBalance(owner, "confirmed");
    const spendable = Math.max(0, lamports - SOL_GAS_BUFFER_LAMPORTS);
    return spendable / 1e9;
  }

  const [legacy, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  const all = [...legacy.value, ...token2022.value];
  let total = 0;
  for (const acc of all) {
    const parsed = acc.account.data.parsed?.info;
    if (parsed?.mint !== mint) continue;
    const ui = parsed?.tokenAmount?.uiAmount;
    if (typeof ui === "number" && Number.isFinite(ui)) total += ui;
  }
  return total;
}
