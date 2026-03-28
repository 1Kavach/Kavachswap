/**
 * Kavach Rewards — init_global (discriminator 0).
 * On-chain global config stores ONE authority pubkey (admin for init_farm, fund_rewards, pause, etc.).
 * There is no separate "treasury" account in rewards — set authority to your ops wallet (e.g. me.json).
 *
 * Usage (PowerShell):
 *   cd c:\126\DExs\Kavach
 *   $env:RPC_URL="https://api.mainnet-beta.solana.com"
 *   $env:KAVACH_REWARDS_PROGRAM_ID="<your_rewards_program_id>"
 *   $env:AUTHORITY_KEYPAIR="c:\126\files\me.json"
 *   $env:PAYER_KEYPAIR="c:\126\files\wallet_0.json"
 *   node scripts/init-rewards-global.mjs
 *
 * If authority and payer are the same wallet, set only AUTHORITY_KEYPAIR (payer defaults to same).
 */
import fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const REWARDS_ID = process.env.KAVACH_REWARDS_PROGRAM_ID;
if (!REWARDS_ID) {
  console.error("Set KAVACH_REWARDS_PROGRAM_ID to your deployed kavach_rewards program id.");
  process.exit(1);
}

function loadKeypair(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const authPath = process.env.AUTHORITY_KEYPAIR ?? "c:\\126\\files\\me.json";
const payPath = process.env.PAYER_KEYPAIR ?? process.env.AUTHORITY_KEYPAIR ?? authPath;

const authority = loadKeypair(authPath);
const payer = payPath === authPath ? authority : loadKeypair(payPath);

const rewardsProg = new PublicKey(REWARDS_ID);
const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], rewardsProg);

const conn = new Connection(RPC, "confirmed");
const existing = await conn.getAccountInfo(configPda);
if (existing && existing.data.length >= 2 && existing.data[0] === 1) {
  console.log("Config already initialized. config PDA:", configPda.toBase58());
  const auth = new PublicKey(existing.data.subarray(2, 34));
  console.log("Stored authority:", auth.toBase58());
  process.exit(0);
}

const ix = new TransactionInstruction({
  programId: rewardsProg,
  keys: [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([0]),
});

const signers =
  authority.publicKey.equals(payer.publicKey) ? [authority] : [authority, payer];

const tx = new Transaction().add(ix);
const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
console.log("init_global OK");
console.log("Signature:", sig);
console.log("Config PDA:", configPda.toBase58());
console.log("Authority (admin):", authority.publicKey.toBase58());
