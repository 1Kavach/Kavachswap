/**
 * Kavach Core AMM — TS client for kavach_amm_core program.
 * Discriminators: 0=InitializePool, 1=Swap, 2=AddLiquidity, 3=RemoveLiquidity, 4=CollectFees,
 * 5=AddInitialLiquidity (empty pool: amountA + B-per-A ratio as u128/u128 → program derives amountB).
 * Pool PDA: ["pool", token_a_mint, token_b_mint]; token_a_mint < token_b_mint (canonical order).
 */
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "./connection";
import {
  KAVACH_AMM_CORE_PROGRAM_ID,
  KAVACH_MINT,
  WSOL_MINT,
  PROTOCOL_TREASURY,
} from "./constants";

const PROGRAM_ID = new PublicKey(KAVACH_AMM_CORE_PROGRAM_ID);

/** Allowed fee tier numerators (per 10000): 1, 5, 10, 25, 50, 80, 100, 125, 150, 200, 250, 300, 400 bps */
export const CORE_FEE_TIERS_BPS = [1, 5, 10, 25, 50, 80, 100, 125, 150, 200, 250, 300, 400];

/** Default fee tier for KVH/SOL: 50 bps = 0.5% (must be in CORE_FEE_TIERS_BPS). */
export const DEFAULT_FEE_TIER_BPS = 50;
const FEE_DENOMINATOR = 10_000;

function writeU64(buf: Uint8Array, offset: number, val: number): void {
  const v = BigInt(val);
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number((v >> BigInt(i * 8)) & 0xffn);
  }
}

function writeBool(buf: Uint8Array, offset: number, val: boolean): void {
  buf[offset] = val ? 1 : 0;
}

function writeU128LE(buf: Uint8Array, offset: number, val: bigint): void {
  let v = val;
  for (let i = 0; i < 16; i++) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Derive pool PDA. Mints must be in canonical order (a < b). */
export function getPoolPda(mintA: PublicKey, mintB: PublicKey): [PublicKey, number] {
  if (mintA.toBuffer().compare(mintB.toBuffer()) > 0) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintB.toBuffer(), mintA.toBuffer()],
      PROGRAM_ID
    );
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
    PROGRAM_ID
  );
}

/** Pool state (minimal for UI). Borsh layout matches programs/kavach_amm_core/src/state.rs */
export interface PoolState {
  isInitialized: boolean;
  bump: number;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  lpMint: PublicKey;
  feeNumerator: number;
  feeDenominator: number;
  protocolFeeBps: number;
  creatorFeeBps: number;
}

const POOL_LEN = 1 + 1 + 32 * 7 + 8 * 4 + 32 * 2 + 8 * 2 + 16 * 2 + 8;
export const CORE_POOL_ACCOUNT_LEN = POOL_LEN;

function readPubkey(data: Uint8Array, offset: number): PublicKey {
  return new PublicKey(data.slice(offset, offset + 32));
}

function readU64(data: Uint8Array, offset: number): number {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(data[offset + i]) << BigInt(i * 8);
  }
  return Number(v);
}

export function decodePoolState(data: Uint8Array): PoolState {
  if (data.length < POOL_LEN) throw new Error("Pool account data too short");
  let o = 0;
  const isInitialized = data[o++] !== 0;
  const bump = data[o++];
  const tokenAMint = readPubkey(data, o); o += 32;
  const tokenBMint = readPubkey(data, o); o += 32;
  const tokenAVault = readPubkey(data, o); o += 32;
  const tokenBVault = readPubkey(data, o); o += 32;
  const lpMint = readPubkey(data, o); o += 32;
  o += 32; // lp_token_program
  const feeNumerator = readU64(data, o); o += 8;
  const feeDenominator = readU64(data, o); o += 8;
  const protocolFeeBps = readU64(data, o); o += 8;
  const creatorFeeBps = readU64(data, o); o += 8;
  return {
    isInitialized,
    bump,
    tokenAMint,
    tokenBMint,
    tokenAVault,
    tokenBVault,
    lpMint,
    feeNumerator,
    feeDenominator,
    protocolFeeBps,
    creatorFeeBps,
  };
}

/** Fetch and decode pool account. Returns null if account doesn't exist or is invalid. */
export async function getPoolState(poolPda: PublicKey): Promise<PoolState | null> {
  const connection = getConnection();
  const acc = await connection.getAccountInfo(poolPda);
  if (!acc?.data || acc.data.length < POOL_LEN) return null;
  try {
    return decodePoolState(acc.data);
  } catch {
    return null;
  }
}

/** Build InitializePool instruction. Vaults and lp_mint are new keypair accounts (program creates them); pass keypairs so tx can sign. */
export function buildInitializePoolIx(params: {
  mintA: PublicKey;
  mintB: PublicKey;
  feeTierBps: number; // e.g. 30 for 0.3%
  protocolFeeBps?: number; // default 5000 (50%)
  creatorFeeBps?: number; // default 5000 (50%)
  payer: PublicKey;
  protocolRecipient?: PublicKey;
  creatorRecipient?: PublicKey;
  /** New keypairs for vault A, vault B, LP mint (program creates accounts at these addresses). */
  vaultAKeypair: { publicKey: PublicKey };
  vaultBKeypair: { publicKey: PublicKey };
  lpMintKeypair: { publicKey: PublicKey };
}): { instruction: TransactionInstruction; poolPda: PublicKey } {
  const {
    mintA,
    mintB,
    feeTierBps,
    protocolFeeBps = 5000,
    creatorFeeBps = 5000,
    payer,
    protocolRecipient = new PublicKey(PROTOCOL_TREASURY),
    creatorRecipient = new PublicKey(PROTOCOL_TREASURY),
    vaultAKeypair,
    vaultBKeypair,
    lpMintKeypair,
  } = params;

  if (protocolFeeBps + creatorFeeBps !== 10000) throw new Error("protocolFeeBps + creatorFeeBps must equal 10000");
  if (!CORE_FEE_TIERS_BPS.includes(feeTierBps)) throw new Error("Invalid fee tier; use CORE_FEE_TIERS_BPS");

  const [poolPda] = getPoolPda(mintA, mintB);
  const vaultA = vaultAKeypair.publicKey;
  const vaultB = vaultBKeypair.publicKey;
  const lpMint = lpMintKeypair.publicKey;

  const tokenProgram = TOKEN_PROGRAM_ID;
  const data = new Uint8Array(1 + 8 * 4);
  data[0] = 0; // discriminator InitializePool
  writeU64(data, 1, feeTierBps);
  writeU64(data, 9, FEE_DENOMINATOR);
  writeU64(data, 17, protocolFeeBps);
  writeU64(data, 25, creatorFeeBps);

  const keys = [
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },
    { pubkey: vaultA, isSigner: true, isWritable: true },
    { pubkey: vaultB, isSigner: true, isWritable: true },
    { pubkey: lpMint, isSigner: true, isWritable: true },
    { pubkey: protocolRecipient, isSigner: false, isWritable: false },
    { pubkey: creatorRecipient, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });

  return { instruction, poolPda };
}

/** Build Swap instruction. */
export function buildSwapIx(params: {
  poolPda: PublicKey;
  poolState: PoolState;
  user: PublicKey;
  amountIn: number;
  minAmountOut: number;
  aToB: boolean;
}): TransactionInstruction {
  const { poolPda, poolState, user, amountIn, minAmountOut, aToB } = params;
  const vaultIn = aToB ? poolState.tokenAVault : poolState.tokenBVault;
  const vaultOut = aToB ? poolState.tokenBVault : poolState.tokenAVault;
  const userTokenIn = getAssociatedTokenAddressSync(
    aToB ? poolState.tokenAMint : poolState.tokenBMint,
    user
  );
  const userTokenOut = getAssociatedTokenAddressSync(
    aToB ? poolState.tokenBMint : poolState.tokenAMint,
    user
  );
  const tokenProgram = TOKEN_PROGRAM_ID;

  const data = new Uint8Array(1 + 8 + 8 + 1);
  data[0] = 1; // Swap
  writeU64(data, 1, amountIn);
  writeU64(data, 9, minAmountOut);
  writeBool(data, 17, aToB);

  const keys = [
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: vaultIn, isSigner: false, isWritable: true },
    { pubkey: vaultOut, isSigner: false, isWritable: true },
    { pubkey: userTokenIn, isSigner: false, isWritable: true },
    { pubkey: userTokenOut, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
    { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}

/** Build AddLiquidity instruction. */
export function buildAddLiquidityIx(params: {
  poolPda: PublicKey;
  poolState: PoolState;
  user: PublicKey;
  amountA: number;
  amountB: number;
  minLpTokens: number;
}): TransactionInstruction {
  const { poolPda, poolState, user, amountA, amountB, minLpTokens } = params;
  const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, user);
  const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, user);
  const userLpToken = getAssociatedTokenAddressSync(poolState.lpMint, user);
  const tokenProgram = TOKEN_PROGRAM_ID;

  const data = new Uint8Array(1 + 8 * 3);
  data[0] = 2; // AddLiquidity
  writeU64(data, 1, amountA);
  writeU64(data, 9, amountB);
  writeU64(data, 17, minLpTokens);

  const keys = [
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: poolState.tokenAVault, isSigner: false, isWritable: true },
    { pubkey: poolState.tokenBVault, isSigner: false, isWritable: true },
    { pubkey: poolState.lpMint, isSigner: false, isWritable: true },
    { pubkey: userTokenA, isSigner: false, isWritable: true },
    { pubkey: userTokenB, isSigner: false, isWritable: true },
    { pubkey: userLpToken, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
    { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}

/**
 * Human **Token B per 1 Token A** (after decimals) as a decimal string, e.g. `"1.5"` or `"0.000001"`.
 * Returns coprime-ish ratio scaled by `10^precision` (matches on-chain `amount_b` derivation).
 */
export function humanPriceBPerAToRatio(priceStr: string, precision = 18): { num: bigint; den: bigint } {
  const s = priceStr.trim();
  if (!s) throw new Error("Price is empty");
  const negative = s.startsWith("-");
  if (negative) throw new Error("Price must be positive");
  const t = s;
  const dot = t.indexOf(".");
  const whole = dot === -1 ? t : t.slice(0, dot);
  const frac = dot === -1 ? "" : t.slice(dot + 1);
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) throw new Error("Invalid price string");
  const fracPad = (frac + "0".repeat(precision)).slice(0, precision);
  const num = BigInt(whole || "0") * 10n ** BigInt(precision) + BigInt(fracPad || "0");
  const den = 10n ** BigInt(precision);
  if (num <= 0n) throw new Error("Price must be > 0");
  return { num, den };
}

/** Match on-chain `amount_b_for_human_price_b_per_a` (ceil). */
export function computeAmountBRawForListingPrice(
  amountARaw: bigint,
  priceNumerator: bigint,
  priceDenominator: bigint,
  decimalsA: number,
  decimalsB: number,
): bigint {
  if (priceDenominator === 0n || priceNumerator <= 0n || amountARaw <= 0n) {
    throw new Error("Invalid price or amount");
  }
  const scaleA = 10n ** BigInt(decimalsA);
  const scaleB = 10n ** BigInt(decimalsB);
  const num = amountARaw * priceNumerator * scaleB;
  const den = priceDenominator * scaleA;
  return (num + den - 1n) / den;
}

/**
 * First deposit only (empty pool). Same accounts as AddLiquidity; data includes B-per-A ratio (two u128s).
 * On-chain derives `amount_b`; pool state still has no “price” field — only reserves.
 */
export function buildAddInitialLiquidityIx(params: {
  poolPda: PublicKey;
  poolState: PoolState;
  user: PublicKey;
  amountA: number;
  priceNumerator: bigint;
  priceDenominator: bigint;
  minLpTokens: number;
}): TransactionInstruction {
  const { poolPda, poolState, user, amountA, priceNumerator, priceDenominator, minLpTokens } = params;
  if (priceNumerator <= 0n || priceDenominator <= 0n) throw new Error("Invalid price ratio");
  let pn = priceNumerator;
  let pd = priceDenominator;
  if (pn > (1n << 128n) - 1n || pd > (1n << 128n) - 1n) {
    throw new Error("Price ratio too large for u128");
  }
  const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, user);
  const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, user);
  const userLpToken = getAssociatedTokenAddressSync(poolState.lpMint, user);
  const tokenProgram = TOKEN_PROGRAM_ID;

  const data = new Uint8Array(1 + 8 + 16 + 16 + 8);
  data[0] = 5;
  writeU64(data, 1, amountA);
  writeU128LE(data, 9, pn);
  writeU128LE(data, 25, pd);
  writeU64(data, 41, minLpTokens);

  const keys = [
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: poolState.tokenAVault, isSigner: false, isWritable: true },
    { pubkey: poolState.tokenBVault, isSigner: false, isWritable: true },
    { pubkey: poolState.lpMint, isSigner: false, isWritable: true },
    { pubkey: userTokenA, isSigner: false, isWritable: true },
    { pubkey: userTokenB, isSigner: false, isWritable: true },
    { pubkey: userLpToken, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
    { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}

/** Build RemoveLiquidity instruction. */
export function buildRemoveLiquidityIx(params: {
  poolPda: PublicKey;
  poolState: PoolState;
  user: PublicKey;
  lpTokens: number;
  minAmountA: number;
  minAmountB: number;
}): TransactionInstruction {
  const { poolPda, poolState, user, lpTokens, minAmountA, minAmountB } = params;
  const userTokenA = getAssociatedTokenAddressSync(poolState.tokenAMint, user);
  const userTokenB = getAssociatedTokenAddressSync(poolState.tokenBMint, user);
  const userLpToken = getAssociatedTokenAddressSync(poolState.lpMint, user);
  const tokenProgram = TOKEN_PROGRAM_ID;

  const data = new Uint8Array(1 + 8 * 3);
  data[0] = 3; // RemoveLiquidity
  writeU64(data, 1, lpTokens);
  writeU64(data, 9, minAmountA);
  writeU64(data, 17, minAmountB);

  const keys = [
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: poolState.tokenAVault, isSigner: false, isWritable: true },
    { pubkey: poolState.tokenBVault, isSigner: false, isWritable: true },
    { pubkey: poolState.lpMint, isSigner: false, isWritable: true },
    { pubkey: userTokenA, isSigner: false, isWritable: true },
    { pubkey: userTokenB, isSigner: false, isWritable: true },
    { pubkey: userLpToken, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
    { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}

/** KVH/SOL pool PDA (canonical: KVH < WSOL). */
export const KVH_SOL_MINT_A = new PublicKey(KAVACH_MINT);
export const KVH_SOL_MINT_B = new PublicKey(WSOL_MINT);

export function getKvhSolPoolPda(): PublicKey {
  const [pda] = getPoolPda(KVH_SOL_MINT_A, KVH_SOL_MINT_B);
  return pda;
}

/** Check if a KVH/SOL pool exists on-chain (for UI to show Kavach AMM path). */
export async function hasKvhSolPool(): Promise<boolean> {
  const pda = getKvhSolPoolPda();
  const state = await getPoolState(pda);
  return state?.isInitialized ?? false;
}

/** Check if a Kavach AMM pool exists for the given mint pair (canonical order handled inside). */
export async function hasPoolForMints(mintA: PublicKey, mintB: PublicKey): Promise<boolean> {
  const [pda] = getPoolPda(mintA, mintB);
  const state = await getPoolState(pda);
  return state?.isInitialized ?? false;
}

/** Get pool state for a mint pair. Returns null if pool does not exist or is not initialized. */
export async function getPoolStateForMints(mintA: PublicKey, mintB: PublicKey): Promise<PoolState | null> {
  const [pda] = getPoolPda(mintA, mintB);
  return getPoolState(pda);
}

/** Get pool PDA for a mint pair (canonical order). */
export function getPoolPdaForMints(mintA: PublicKey, mintB: PublicKey): PublicKey {
  const [pda] = getPoolPda(mintA, mintB);
  return pda;
}

/** SPL token account: amount at offset 64 (u64 LE). */
function getTokenAccountAmount(data: Uint8Array): number {
  if (data.length < 72) return 0;
  return readU64(data, 64);
}

/** Fetch pool vault reserves (raw amounts). */
export async function getPoolReserves(
  connection: ReturnType<typeof getConnection>,
  poolState: PoolState
): Promise<{ reserveA: number; reserveB: number }> {
  const [accA, accB] = await Promise.all([
    connection.getAccountInfo(poolState.tokenAVault),
    connection.getAccountInfo(poolState.tokenBVault),
  ]);
  const reserveA = accA?.data ? getTokenAccountAmount(new Uint8Array(accA.data)) : 0;
  const reserveB = accB?.data ? getTokenAccountAmount(new Uint8Array(accB.data)) : 0;
  return { reserveA, reserveB };
}

/** SPL mint: supply at offset 36 (u64 LE). */
function getMintSupply(data: Uint8Array): number {
  if (data.length < 44) return 0;
  return readU64(data, 36);
}

/** Fetch LP mint total supply (raw). */
export async function getLpSupply(
  connection: ReturnType<typeof getConnection>,
  poolState: PoolState
): Promise<number> {
  const acc = await connection.getAccountInfo(poolState.lpMint);
  if (!acc?.data) return 0;
  return getMintSupply(new Uint8Array(acc.data));
}

/** Fetch user's LP token balance for a pool (raw amount). Returns 0 if no ATA or error. */
export async function getUserLpBalance(
  connection: ReturnType<typeof getConnection>,
  poolState: PoolState,
  user: PublicKey
): Promise<number> {
  const userLpAta = getAssociatedTokenAddressSync(poolState.lpMint, user);
  const acc = await connection.getAccountInfo(userLpAta);
  if (!acc?.data) return 0;
  return getTokenAccountAmount(new Uint8Array(acc.data));
}

/**
 * Withdrawal amounts for burning lpTokens (matches program math).
 * Use for preview and to compute minAmountA/minAmountB with slippage.
 */
export function calculateWithdrawalAmounts(
  lpTokens: number,
  reserveA: number,
  reserveB: number,
  lpSupply: number
): { amountA: number; amountB: number } {
  if (lpTokens <= 0 || lpSupply <= 0) return { amountA: 0, amountB: 0 };
  if (lpTokens > lpSupply) return { amountA: 0, amountB: 0 };
  const amountA = Math.floor((Number(BigInt(lpTokens) * BigInt(reserveA)) / lpSupply));
  const amountB = Math.floor((Number(BigInt(lpTokens) * BigInt(reserveB)) / lpSupply));
  return { amountA, amountB };
}

/** Constant-product swap quote (matches program math). Fee on input. */
export function getKavachSwapQuote(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  feeNumerator: number,
  feeDenominator: number
): { amountOut: number; feeAmount: number } {
  if (amountIn === 0 || reserveIn === 0 || reserveOut === 0) {
    return { amountOut: 0, feeAmount: 0 };
  }
  const feeMult = feeDenominator - feeNumerator;
  const amountInWithFee = BigInt(amountIn) * BigInt(feeMult);
  const numerator = amountInWithFee * BigInt(reserveOut);
  const denominator = BigInt(reserveIn) * BigInt(feeDenominator) + amountInWithFee;
  const amountOut = Number(numerator / denominator);
  const feeAmount = Math.floor((Number(amountIn) * feeNumerator) / feeDenominator);
  return { amountOut, feeAmount };
}
