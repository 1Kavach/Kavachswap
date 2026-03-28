/**
 * Deploy KVH token — SPL only, NO Rust, NO Anchor.
 * Cost: ~0.002 SOL rent + tx fee.
 *
 * Run: npx ts-node scripts/deploy-kvh.ts
 * Requires: SOL in wallet at ~/.config/solana/id.json
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const TOKEN_NAME = "Kavach";
const TOKEN_SYMBOL = "KVH";
const TOTAL_SUPPLY = 10_000_000_000;
const DECIMALS = 6;
const TOKEN_URI = "https://tomato-impossible-warbler-875.mypinata.cloud/ipfs/REPLACE_WITH_CID";

const MINT_RECIPIENT = new PublicKey(
  "H8t886PgU6XKSV5DJPehqggVwJwHBCnBMkGKGcUzqhXj"
);

async function main() {
  const rpc =
    process.env.VITE_SOLANA_RPC || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpc);

  const keypairPath =
    process.env.ANCHOR_WALLET || path.join(process.env.HOME || "", ".config/solana/id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log("🚀 Deploy KVH (SPL only, no Rust)");
  console.log("Wallet:", payer.publicKey.toString());
  console.log("RPC:", rpc);

  const { buildCreateTokenInstructions, instructionsToTransaction } = await import(
    "../src/lib/token"
  );

  const mintKeypair = Keypair.generate();

  const instructions = await buildCreateTokenInstructions({
    connection,
    payer: payer.publicKey,
    mintKeypair,
    decimals: DECIMALS,
    amount: BigInt(TOTAL_SUPPLY) * BigInt(10 ** DECIMALS),
    destination: MINT_RECIPIENT,
  });

  const tx = instructionsToTransaction(instructions, payer.publicKey, [mintKeypair]);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const sig = await connection.sendTransaction(tx, [payer, mintKeypair]);
  console.log("TX:", sig);
  await connection.confirmTransaction(sig);

  const deploymentInfo = {
    network: rpc,
    timestamp: new Date().toISOString(),
    tokens: {
      KVH: {
        mint: mintKeypair.publicKey.toString(),
        decimals: DECIMALS,
        supply: TOTAL_SUPPLY.toString(),
        recipient: MINT_RECIPIENT.toString(),
        uri: TOKEN_URI,
      },
    },
  };

  const outPath = path.join(__dirname, "../deployment-info.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("\n✅ KVH deployed!");
  console.log("Mint:", mintKeypair.publicKey.toString());
  console.log("📄 Saved to", outPath);
  console.log("\nNext: Set KAVACH_MINT in src/lib/constants.ts from tokens.KVH.mint");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
