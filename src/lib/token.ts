/**
 * SPL token creation. Built-in Token Program only.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

export async function buildCreateTokenInstructions(params: {
  connection: Connection;
  payer: PublicKey;
  mintKeypair: Keypair;
  decimals: number;
  amount: bigint;
  destination: PublicKey;
}): Promise<TransactionInstruction[]> {
  const { connection, payer, mintKeypair, decimals, amount, destination } = params;
  const rent = await getMinimumBalanceForRentExemptMint(connection);
  const ata = getAssociatedTokenAddressSync(mintKeypair.publicKey, destination, false);

  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mintKeypair.publicKey,
      space: 82,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      decimals,
      payer,
      null,
      TOKEN_PROGRAM_ID
    ),
    createAssociatedTokenAccountInstruction(
      payer,
      ata,
      destination,
      mintKeypair.publicKey
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      ata,
      payer,
      amount,
      [],
      TOKEN_PROGRAM_ID
    ),
  ];
}

export function instructionsToTransaction(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  signers: Keypair[] = []
): Transaction {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = payer;
  signers.forEach((s) => tx.partialSign(s));
  return tx;
}
