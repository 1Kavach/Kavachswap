/**
 * Portfolio: SOL balance + SPL token balances for connected wallet.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getBuiltInTokens } from "./tokenReader";

export interface TokenBalance {
  mint: string;
  symbol: string;
  decimals: number;
  amount: string;
  amountRaw: string;
  uiAmount: number;
}

export interface PortfolioBalances {
  sol: { lamports: number; sol: string };
  tokens: TokenBalance[];
}

export async function getPortfolioBalances(
  connection: Connection,
  walletAddress: string
): Promise<PortfolioBalances> {
  const pk = new PublicKey(walletAddress);
  const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  const [solBalance, tokenAccounts] = await Promise.all([
    connection.getBalance(pk),
    connection.getParsedTokenAccountsByOwner(pk, { programId: tokenProgramId }),
  ]);

  const sol = {
    lamports: solBalance,
    sol: (solBalance / 1e9).toFixed(6),
  };

  const builtIn = getBuiltInTokens();
  const tokens: TokenBalance[] = [];

  for (const { account } of tokenAccounts.value) {
    const data = account.data;
    if (data.parsed?.info?.tokenAmount?.uiAmount === 0) continue;
    const mint = data.parsed?.info?.mint as string | undefined;
    const decimals = data.parsed?.info?.tokenAmount?.decimals ?? 0;
    const amountRaw = data.parsed?.info?.tokenAmount?.amount ?? "0";
    const uiAmount = data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    if (!mint) continue;
    const known = builtIn.find((t) => t.mint === mint);
    const symbol = known?.symbol ?? "Token";
    tokens.push({
      mint,
      symbol,
      decimals,
      amount: uiAmount.toFixed(6),
      amountRaw,
      uiAmount: Number(uiAmount),
    });
  }

  return { sol, tokens };
}
