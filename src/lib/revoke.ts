/**
 * Revoke token authorities: mint, freeze, update (metadata). Fee: 0.006 SOL each, 0.02 SOL for all 3 (bundle).
 * SPL: mint + freeze via SetAuthority. Metadata update authority via Metaplex (if token has metadata).
 * @see https://solana.com/docs/tokens/basics/set-authority
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  createSetAuthorityInstruction,
  AuthorityType,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PROTOCOL_TREASURY,
  REVOKE_MINT_FEE_LAMPORTS,
  REVOKE_FREEZE_FEE_LAMPORTS,
  REVOKE_UPDATE_FEE_LAMPORTS,
  REVOKE_ALL_AUTHORITIES_FEE_LAMPORTS,
} from "./constants";

export type RevokeOption = "mint" | "freeze" | "update" | "all";

/**
 * Build instructions to revoke one or more token authorities.
 * - mint: revoke mint authority (no more minting). 0.006 SOL.
 * - freeze: revoke freeze authority (no freezing accounts). 0.006 SOL.
 * - update: revoke metadata update authority (requires Metaplex metadata). 0.006 SOL.
 * - all: revoke all 3 (bundle). 0.02 SOL.
 */
export function buildRevokeAuthorityInstructions(params: {
  mint: PublicKey;
  currentAuthority: PublicKey;
  revoke: RevokeOption;
}): { instructions: TransactionInstruction[]; feeLamports: number } {
  const { mint, currentAuthority, revoke } = params;
  const instructions: TransactionInstruction[] = [];
  let feeLamports: number;

  if (revoke === "all") {
    instructions.push(
      createSetAuthorityInstruction(
        mint,
        currentAuthority,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_PROGRAM_ID
      ),
      createSetAuthorityInstruction(
        mint,
        currentAuthority,
        AuthorityType.FreezeAccount,
        null,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    instructions.push(buildRevokeMetadataUpdateAuthorityInstruction(mint, currentAuthority));
    feeLamports = REVOKE_ALL_AUTHORITIES_FEE_LAMPORTS;
  } else if (revoke === "update") {
    instructions.push(buildRevokeMetadataUpdateAuthorityInstruction(mint, currentAuthority));
    feeLamports = REVOKE_UPDATE_FEE_LAMPORTS;
  } else if (revoke === "mint") {
    instructions.push(
      createSetAuthorityInstruction(
        mint,
        currentAuthority,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    feeLamports = REVOKE_MINT_FEE_LAMPORTS;
  } else {
    instructions.push(
      createSetAuthorityInstruction(
        mint,
        currentAuthority,
        AuthorityType.FreezeAccount,
        null,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    feeLamports = REVOKE_FREEZE_FEE_LAMPORTS;
  }

  if (PROTOCOL_TREASURY && feeLamports > 0) {
    instructions.unshift(
      SystemProgram.transfer({
        fromPubkey: currentAuthority,
        toPubkey: new PublicKey(PROTOCOL_TREASURY),
        lamports: feeLamports,
      })
    );
  }

  return { instructions, feeLamports };
}

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/**
 * Build instruction to revoke metadata update authority (set to system program).
 * Token must have Metaplex metadata; otherwise the transaction will fail on-chain.
 */
function buildRevokeMetadataUpdateAuthorityInstruction(
  mint: PublicKey,
  updateAuthority: PublicKey
): TransactionInstruction {
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );

  // UpdateMetadataAccountV2: discriminator 15, data=None, newUpdateAuthority=SystemProgram (revoke), primarySaleHappened=None, isMutable=None
  // Umi Option: 0=None, 1=Some. PublicKey = 32 bytes. Total: 1+1+33+1+1 = 37 bytes.
  const data = Buffer.alloc(37);
  let off = 0;
  data.writeUInt8(15, off); off += 1;   // discriminator
  data.writeUInt8(0, off); off += 1;    // data = None
  data.writeUInt8(1, off); off += 1;    // newUpdateAuthority = Some
  SystemProgram.programId.toBuffer().copy(data, off); off += 32;
  data.writeUInt8(0, off); off += 1;    // primarySaleHappened = None
  data.writeUInt8(0, off);              // isMutable = None

  return new TransactionInstruction({
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: updateAuthority, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_METADATA_PROGRAM_ID,
    data,
  });
}
