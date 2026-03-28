/**
 * SPL Token Airdrop — batch transfers. Logic inspired by Helius AirShip, simplified for standard SPL (no ZK compression).
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export const MAX_RECIPIENTS_PER_TX = 18;
const COMPUTE_UNIT_LIMIT = 400_000;
const COMPUTE_UNIT_PRICE = 10_000;

export interface AirdropParams {
  connection: Connection;
  sender: PublicKey;
  mint: PublicKey;
  recipients: PublicKey[];
  amountPerRecipient: bigint;
}

export interface AirdropResult {
  success: boolean;
  signature?: string;
  recipientCount: number;
  error?: string;
}

/**
export async function executeAirdropBatch(params: AirdropParams): Promise<AirdropResult> {
  const { connection, sender, mint, recipients, amountPerRecipient } = params;

  if (recipients.length === 0) {
    return { success: false, recipientCount: 0, error: "No recipients" };
  }

  const sourceAta = getAssociatedTokenAddressSync(mint, sender, false);
  const sourceAcc = await connection.getAccountInfo(sourceAta);
  if (!sourceAcc) {
    return { success: false, recipientCount: 0, error: "Sender has no token account for this mint" };
  }

  const instructions: TransactionInstruction[] = [];
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE })
  );

  for (const recipient of recipients.slice(0, MAX_RECIPIENTS_PER_TX)) {
    const destAta = getAssociatedTokenAddressSync(mint, recipient, false);
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        sender, destAta, recipient, mint
      ),
      createTransferInstruction(
        sourceAta,
        destAta,
        sender,
        amountPerRecipient,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  return { success: true, recipientCount: recipients.length } as AirdropResult;
}

/**
 * Build airdrop instructions for one batch. Used by UI to build and sign.
 */
export async function buildAirdropInstructions(params: {
  connection: Connection;
  sender: PublicKey;
  mint: PublicKey;
  recipients: PublicKey[];
  amountPerRecipient: bigint;
}): Promise<TransactionInstruction[]> {
  const { sender, mint, recipients, amountPerRecipient } = params;
  const sourceAta = getAssociatedTokenAddressSync(mint, sender, false);

  const instructions: TransactionInstruction[] = [];
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE })
  );

  const batch = recipients.slice(0, MAX_RECIPIENTS_PER_TX);
  for (const recipient of batch) {
    const destAta = getAssociatedTokenAddressSync(mint, recipient, false);
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(sender, destAta, recipient, mint),
      createTransferInstruction(
        sourceAta,
        destAta,
        sender,
        amountPerRecipient,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  return instructions;
}
