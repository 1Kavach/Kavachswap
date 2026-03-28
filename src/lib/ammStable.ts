import {
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "./connection";
import { KAVACH_STABLE_AMM_PROGRAM_ID } from "./constants";

const PROGRAM_ID = new PublicKey(KAVACH_STABLE_AMM_PROGRAM_ID);
export const STABLE_POOL_ACCOUNT_LEN = 512;

function readPubkey(data: Uint8Array, offset: number): PublicKey {
  return new PublicKey(data.slice(offset, offset + 32));
}

function readU64(data: Uint8Array, offset: number): number {
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(data[offset + i]) << BigInt(i * 8);
  return Number(v);
}

function writeU64(buf: Uint8Array, offset: number, val: number): void {
  const v = BigInt(val);
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number((v >> BigInt(i * 8)) & 0xffn);
  }
}

function writeBool(buf: Uint8Array, offset: number, val: boolean): void {
  buf[offset] = val ? 1 : 0;
}

export interface StablePoolState {
  isInitialized: boolean;
  bump: number;
  admin: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  lpMint: PublicKey;
  lpTokenProgram: PublicKey;
  ampFactor: number;
  swapFeeBps: number;
  protocolFeeBps: number;
  creatorFeeBps: number;
  protocolFeeRecipient: PublicKey;
  creatorFeeRecipient: PublicKey;
  tokenADecimals: number;
  tokenBDecimals: number;
}

export const STABLE_DEFAULT_AMP = 100;
export const STABLE_DEFAULT_SWAP_FEE_BPS = 4;

export function getStablePoolPda(mintA: PublicKey, mintB: PublicKey): [PublicKey, number] {
  if (mintA.toBuffer().compare(mintB.toBuffer()) > 0) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintB.toBuffer(), mintA.toBuffer()],
      PROGRAM_ID,
    );
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
    PROGRAM_ID,
  );
}

export function decodeStablePoolState(data: Uint8Array): StablePoolState {
  if (data.length < STABLE_POOL_ACCOUNT_LEN) throw new Error("Stable pool account too short");
  let o = 0;
  const isInitialized = data[o++] !== 0;
  const bump = data[o++];
  const admin = readPubkey(data, o); o += 32;
  const tokenAMint = readPubkey(data, o); o += 32;
  const tokenBMint = readPubkey(data, o); o += 32;
  const tokenAVault = readPubkey(data, o); o += 32;
  const tokenBVault = readPubkey(data, o); o += 32;
  const lpMint = readPubkey(data, o); o += 32;
  const lpTokenProgram = readPubkey(data, o); o += 32;
  const ampFactor = readU64(data, o); o += 8;
  const swapFeeBps = readU64(data, o); o += 8;
  const protocolFeeBps = readU64(data, o); o += 8;
  const creatorFeeBps = readU64(data, o); o += 8;
  const protocolFeeRecipient = readPubkey(data, o); o += 32;
  const creatorFeeRecipient = readPubkey(data, o); o += 32;
  const tokenADecimals = data[o++];
  const tokenBDecimals = data[o++];
  return {
    isInitialized,
    bump,
    admin,
    tokenAMint,
    tokenBMint,
    tokenAVault,
    tokenBVault,
    lpMint,
    lpTokenProgram,
    ampFactor,
    swapFeeBps,
    protocolFeeBps,
    creatorFeeBps,
    protocolFeeRecipient,
    creatorFeeRecipient,
    tokenADecimals,
    tokenBDecimals,
  };
}

export async function getStablePoolState(poolPda: PublicKey): Promise<StablePoolState | null> {
  const connection = getConnection();
  const acc = await connection.getAccountInfo(poolPda);
  if (!acc?.data || acc.data.length < STABLE_POOL_ACCOUNT_LEN) return null;
  try {
    return decodeStablePoolState(acc.data);
  } catch {
    return null;
  }
}

export async function getStablePoolStateForMints(
  mintA: PublicKey,
  mintB: PublicKey,
): Promise<StablePoolState | null> {
  const [poolPda] = getStablePoolPda(mintA, mintB);
  return getStablePoolState(poolPda);
}

export async function hasStablePoolForMints(mintA: PublicKey, mintB: PublicKey): Promise<boolean> {
  const s = await getStablePoolStateForMints(mintA, mintB);
  return !!s?.isInitialized;
}

function tokenAccountAmount(data: Uint8Array): number {
  if (data.length < 72) return 0;
  return readU64(data, 64);
}

export async function getStablePoolReserves(poolState: StablePoolState): Promise<{ reserveA: number; reserveB: number }> {
  const connection = getConnection();
  const [a, b] = await Promise.all([
    connection.getAccountInfo(poolState.tokenAVault),
    connection.getAccountInfo(poolState.tokenBVault),
  ]);
  return {
    reserveA: a?.data ? tokenAccountAmount(new Uint8Array(a.data)) : 0,
    reserveB: b?.data ? tokenAccountAmount(new Uint8Array(b.data)) : 0,
  };
}

/**
 * UI-only approximation for stable quote using reserve ratio + output fee.
 * On-chain output is computed by stable invariant math and can differ.
 */
export function getStableSwapApproxQuote(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  swapFeeBps: number,
): { amountOut: number } {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return { amountOut: 0 };
  const rawOut = Math.floor((amountIn * reserveOut) / reserveIn);
  const fee = Math.floor((rawOut * swapFeeBps) / 10_000);
  return { amountOut: Math.max(0, rawOut - fee) };
}

export async function getMintTokenProgram(mint: PublicKey): Promise<PublicKey> {
  const connection = getConnection();
  const acc = await connection.getAccountInfo(mint);
  if (!acc) throw new Error("Mint account not found");
  return acc.owner;
}

export function buildStableSwapIx(params: {
  poolPda: PublicKey;
  poolState: StablePoolState;
  user: PublicKey;
  amountIn: number;
  minAmountOut: number;
  aToB: boolean;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
}): TransactionInstruction {
  const {
    poolPda,
    poolState,
    user,
    amountIn,
    minAmountOut,
    aToB,
    tokenProgramA,
    tokenProgramB,
  } = params;

  const userTokenIn = getAssociatedTokenAddressSync(
    aToB ? poolState.tokenAMint : poolState.tokenBMint,
    user,
    false,
    aToB ? tokenProgramA : tokenProgramB,
  );
  const userTokenOut = getAssociatedTokenAddressSync(
    aToB ? poolState.tokenBMint : poolState.tokenAMint,
    user,
    false,
    aToB ? tokenProgramB : tokenProgramA,
  );
  const outputMint = aToB ? poolState.tokenBMint : poolState.tokenAMint;
  const outputTokenProgram = aToB ? tokenProgramB : tokenProgramA;
  const protocolFeeAta = getAssociatedTokenAddressSync(
    outputMint,
    poolState.protocolFeeRecipient,
    true,
    outputTokenProgram,
  );
  const creatorFeeAta = getAssociatedTokenAddressSync(
    outputMint,
    poolState.creatorFeeRecipient,
    true,
    outputTokenProgram,
  );

  const data = new Uint8Array(1 + 8 + 8 + 1);
  data[0] = 1; // swap
  writeU64(data, 1, amountIn);
  writeU64(data, 9, minAmountOut);
  writeBool(data, 17, aToB);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: aToB ? poolState.tokenAVault : poolState.tokenBVault, isSigner: false, isWritable: true },
      { pubkey: aToB ? poolState.tokenBVault : poolState.tokenAVault, isSigner: false, isWritable: true },
      { pubkey: userTokenIn, isSigner: false, isWritable: true },
      { pubkey: userTokenOut, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
      { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
      { pubkey: tokenProgramA, isSigner: false, isWritable: false },
      { pubkey: tokenProgramB, isSigner: false, isWritable: false },
      { pubkey: protocolFeeAta, isSigner: false, isWritable: true },
      { pubkey: creatorFeeAta, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function buildStableInitializePoolIx(params: {
  mintA: PublicKey;
  mintB: PublicKey;
  payer: PublicKey;
  protocolRecipient: PublicKey;
  creatorRecipient: PublicKey;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
  vaultAKeypair: { publicKey: PublicKey };
  vaultBKeypair: { publicKey: PublicKey };
  lpMintKeypair: { publicKey: PublicKey };
  ampFactor?: number;
  swapFeeBps?: number;
  protocolFeeBps?: number;
  creatorFeeBps?: number;
}): { instruction: TransactionInstruction; poolPda: PublicKey } {
  const {
    mintA,
    mintB,
    payer,
    protocolRecipient,
    creatorRecipient,
    tokenProgramA,
    tokenProgramB,
    vaultAKeypair,
    vaultBKeypair,
    lpMintKeypair,
    ampFactor = STABLE_DEFAULT_AMP,
    swapFeeBps = STABLE_DEFAULT_SWAP_FEE_BPS,
    protocolFeeBps = 5000,
    creatorFeeBps = 5000,
  } = params;

  const [a, b] = mintA.toBuffer().compare(mintB.toBuffer()) <= 0 ? [mintA, mintB] : [mintB, mintA];
  const tokenProgramForA = a.equals(mintA) ? tokenProgramA : tokenProgramB;
  const tokenProgramForB = a.equals(mintA) ? tokenProgramB : tokenProgramA;
  const [poolPda] = getStablePoolPda(a, b);

  const data = new Uint8Array(1 + 8 * 4);
  data[0] = 0; // initialize
  writeU64(data, 1, ampFactor);
  writeU64(data, 9, swapFeeBps);
  writeU64(data, 17, protocolFeeBps);
  writeU64(data, 25, creatorFeeBps);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: a, isSigner: false, isWritable: false },
      { pubkey: b, isSigner: false, isWritable: false },
      { pubkey: vaultAKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultBKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: lpMintKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolRecipient, isSigner: false, isWritable: false },
      { pubkey: creatorRecipient, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramForA, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: tokenProgramForB, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
  return { instruction, poolPda };
}

export function buildStableAddLiquidityIx(params: {
  poolPda: PublicKey;
  poolState: StablePoolState;
  user: PublicKey;
  amountA: number;
  amountB: number;
  minLpTokens: number;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
}): TransactionInstruction {
  const {
    poolPda,
    poolState,
    user,
    amountA,
    amountB,
    minLpTokens,
    tokenProgramA,
    tokenProgramB,
  } = params;
  const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, user, false, tokenProgramA);
  const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, user, false, tokenProgramB);
  const userLp = getAssociatedTokenAddressSync(poolState.lpMint, user, false, poolState.lpTokenProgram);

  const data = new Uint8Array(1 + 8 + 8 + 8);
  data[0] = 2; // add liquidity
  writeU64(data, 1, amountA);
  writeU64(data, 9, amountB);
  writeU64(data, 17, minLpTokens);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: poolState.tokenAVault, isSigner: false, isWritable: true },
      { pubkey: poolState.tokenBVault, isSigner: false, isWritable: true },
      { pubkey: poolState.lpMint, isSigner: false, isWritable: true },
      { pubkey: userTokenA, isSigner: false, isWritable: true },
      { pubkey: userTokenB, isSigner: false, isWritable: true },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
      { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
      { pubkey: tokenProgramA, isSigner: false, isWritable: false },
      { pubkey: tokenProgramB, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function buildStableRemoveLiquidityIx(params: {
  poolPda: PublicKey;
  poolState: StablePoolState;
  user: PublicKey;
  lpTokens: number;
  minAmountA: number;
  minAmountB: number;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
}): TransactionInstruction {
  const {
    poolPda,
    poolState,
    user,
    lpTokens,
    minAmountA,
    minAmountB,
    tokenProgramA,
    tokenProgramB,
  } = params;
  const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, user, false, tokenProgramA);
  const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, user, false, tokenProgramB);
  const userLp = getAssociatedTokenAddressSync(poolState.lpMint, user, false, poolState.lpTokenProgram);

  const data = new Uint8Array(1 + 8 + 8 + 8);
  data[0] = 3; // remove liquidity
  writeU64(data, 1, lpTokens);
  writeU64(data, 9, minAmountA);
  writeU64(data, 17, minAmountB);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: poolState.tokenAVault, isSigner: false, isWritable: true },
      { pubkey: poolState.tokenBVault, isSigner: false, isWritable: true },
      { pubkey: poolState.lpMint, isSigner: false, isWritable: true },
      { pubkey: userTokenA, isSigner: false, isWritable: true },
      { pubkey: userTokenB, isSigner: false, isWritable: true },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
      { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
      { pubkey: tokenProgramA, isSigner: false, isWritable: false },
      { pubkey: tokenProgramB, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

function mintSupply(data: Uint8Array): number {
  if (data.length < 44) return 0;
  return readU64(data, 36);
}

export async function getStableLpSupply(poolState: StablePoolState): Promise<number> {
  const connection = getConnection();
  const acc = await connection.getAccountInfo(poolState.lpMint);
  if (!acc?.data) return 0;
  return mintSupply(new Uint8Array(acc.data));
}

export async function getStableUserLpBalance(poolState: StablePoolState, user: PublicKey): Promise<number> {
  const connection = getConnection();
  const userLpAta = getAssociatedTokenAddressSync(poolState.lpMint, user, false, poolState.lpTokenProgram);
  const acc = await connection.getAccountInfo(userLpAta);
  if (!acc?.data) return 0;
  return tokenAccountAmount(new Uint8Array(acc.data));
}

export function calculateStableWithdrawalAmounts(
  lpTokens: number,
  reserveA: number,
  reserveB: number,
  lpSupply: number,
): { amountA: number; amountB: number } {
  if (lpTokens <= 0 || lpSupply <= 0 || lpTokens > lpSupply) return { amountA: 0, amountB: 0 };
  return {
    amountA: Math.floor(Number((BigInt(lpTokens) * BigInt(reserveA)) / BigInt(lpSupply))),
    amountB: Math.floor(Number((BigInt(lpTokens) * BigInt(reserveB)) / BigInt(lpSupply))),
  };
}
