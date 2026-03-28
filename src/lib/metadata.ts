/**
 * Metaplex Token Metadata — create metadata for SPL tokens.
 * Uses CreateMetadataAccountV3 (discriminator 33). No Umi dependency.
 */
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TransactionInstruction } from "@solana/web3.js";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function encodeBorshString(s: string): Buffer {
  const buf = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function encodeOptionNone(): Buffer {
  return Buffer.from([0]); // 0 = None
}

/**
 * Build CreateMetadataAccountV3 instruction for Metaplex Token Metadata.
 * @see https://docs.metaplex.com/programs/token-metadata/
 */
export function buildCreateMetadataInstruction(params: {
  mint: PublicKey;
  mintAuthority: PublicKey;
  payer: PublicKey;
  updateAuthority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints?: number;
  isMutable?: boolean;
}): TransactionInstruction {
  const {
    mint,
    mintAuthority,
    payer,
    updateAuthority,
    name,
    symbol,
    uri,
    sellerFeeBasisPoints = 0,
    isMutable = true,
  } = params;

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );

  // DataV2: name, symbol, uri, seller_fee_basis_points, creators (None), collection (None), uses (None)
  const feeBuf = Buffer.alloc(2);
  feeBuf.writeUInt16LE(sellerFeeBasisPoints, 0);
  const dataV2 = Buffer.concat([
    encodeBorshString(name),
    encodeBorshString(symbol),
    encodeBorshString(uri),
    feeBuf,
    encodeOptionNone(), // creators = None
    encodeOptionNone(), // collection = None
    encodeOptionNone(), // uses = None
  ]);

  // CreateMetadataAccountV3: discriminator 33, data (DataV2), is_mutable, collection_details (None)
  const data = Buffer.concat([
    Buffer.from([33]), // discriminator
    dataV2,
    Buffer.from([isMutable ? 1 : 0]),
    encodeOptionNone(), // collection_details = None
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: TOKEN_METADATA_PROGRAM_ID,
    data,
  });
}
