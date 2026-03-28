/**
 * Sign and send transaction — Wallet Standard (Phantom, etc) with legacy fallback.
 */
import { Connection, Keypair, Transaction, PublicKey } from "@solana/web3.js";

declare global {
  interface Window {
    solana?: SolanaWalletProvider;
    phantom?: { solana?: SolanaWalletProvider };
    solflare?: SolanaWalletProvider;
    backpack?: SolanaWalletProvider;
    glow?: SolanaWalletProvider;
  }
}

interface SolanaWalletProvider {
  signTransaction?(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction?(tx: Transaction): Promise<{ signature: string }>;
  publicKey?: { toString(): string };
}

export async function signAndSendTransaction(params: {
  connection: Connection;
  wallet: { address: string; features?: Record<string, unknown> };
  transaction: Transaction;
  signers?: Keypair[];
}): Promise<string> {
  const { connection, wallet, transaction, signers = [] } = params;
  const payer = new PublicKey(wallet.address);

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer;
  signers.forEach((s) => transaction.partialSign(s));

  // 1) Wallet Standard: signAndSendTransaction
  const feature = (wallet.features as Record<string, { signAndSendTransaction?: (args: { transaction: Transaction }) => Promise<{ signature: string }> }>)?.["solana:signAndSendTransaction"];
  if (feature?.signAndSendTransaction) {
    const { signature } = await feature.signAndSendTransaction({ transaction });
    return signature;
  }

  // 2) Wallet Standard: signTransaction only
  const signTx = (wallet.features as Record<string, { signTransaction?: (args: { transaction: Transaction }) => Promise<Transaction> }>)?.["solana:signTransaction"];
  if (signTx?.signTransaction) {
    const signed = await signTx.signTransaction({ transaction });
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    return sig;
  }

  // 3) Legacy: try injected providers (Phantom, Solflare, Backpack, Glow, etc.)
  const providers: SolanaWalletProvider[] = [];
  if (typeof window !== "undefined") {
    if (window.solana) providers.push(window.solana);
    if (window.phantom?.solana) providers.push(window.phantom.solana);
    if (window.solflare) providers.push(window.solflare);
    if (window.backpack) providers.push(window.backpack);
    if (window.glow) providers.push(window.glow);
  }
  const walletAddr = payer.toBase58();
  // Prefer provider whose publicKey matches connected wallet
  const sorted = providers.slice().sort((a, b) => {
    const aMatch = a.publicKey?.toString() === walletAddr ? 1 : 0;
    const bMatch = b.publicKey?.toString() === walletAddr ? 1 : 0;
    return bMatch - aMatch;
  });
  for (const provider of sorted) {
    if (provider?.signAndSendTransaction) {
      try {
        const { signature } = await provider.signAndSendTransaction(transaction);
        return signature;
      } catch (_) {
        continue;
      }
    }
    if (provider?.signTransaction) {
      try {
        const signed = await provider.signTransaction(transaction);
        const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
        return sig;
      } catch (_) {
        continue;
      }
    }
  }

  throw new Error("Wallet does not support signTransaction or signAndSendTransaction. Try Phantom, Solflare, or Backpack and open this app at http://localhost (not file://).");
}
