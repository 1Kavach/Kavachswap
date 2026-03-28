import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { KAVACH_REWARDS_PROGRAM_ID } from "./constants";

export const REWARDS_PROGRAM_ID = new PublicKey(KAVACH_REWARDS_PROGRAM_ID);
const ACC_PRECISION = 1_000_000_000_000n;
const GLOBAL_LEN = 34;
const FARM_LEN = 171;
const STAKE_LEN = 32;

function readU64(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(data[offset + i]) << BigInt(8 * i);
  }
  return v;
}

function readI64(data: Uint8Array, offset: number): bigint {
  const u = readU64(data, offset);
  return u > 0x7fffffffffffffffn ? u - 0x10000000000000000n : u;
}

function readU128(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 16; i++) {
    v |= BigInt(data[offset + i]) << BigInt(8 * i);
  }
  return v;
}

function writeU64(data: Uint8Array, off: number, value: bigint): void {
  for (let i = 0; i < 8; i++) {
    data[off + i] = Number((value >> BigInt(i * 8)) & 0xffn);
  }
}

export interface RewardsGlobalConfig {
  version: number;
  bump: number;
  authority: PublicKey;
}

export interface RewardsFarmState {
  version: number;
  farmBump: number;
  paused: boolean;
  lpMint: PublicKey;
  rewardMint: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  rewardRate: bigint;
  lastUpdate: bigint;
  accRewardPerShare: bigint;
  totalStaked: bigint;
}

export interface RewardsUserStakeState {
  amount: bigint;
  rewardDebt: bigint;
}

export function getRewardsConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], REWARDS_PROGRAM_ID);
}

export function getRewardsFarmPda(lpMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("farm"), lpMint.toBuffer()], REWARDS_PROGRAM_ID);
}

export function getRewardsStakePda(farm: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), farm.toBuffer(), user.toBuffer()],
    REWARDS_PROGRAM_ID,
  );
}

export function decodeGlobalConfig(data: Uint8Array): RewardsGlobalConfig {
  if (data.length < GLOBAL_LEN) throw new Error("Invalid global config length");
  return {
    version: data[0],
    bump: data[1],
    authority: new PublicKey(data.slice(2, 34)),
  };
}

export function decodeFarmState(data: Uint8Array): RewardsFarmState {
  if (data.length < FARM_LEN) throw new Error("Invalid farm length");
  return {
    version: data[0],
    farmBump: data[1],
    paused: data[2] !== 0,
    lpMint: new PublicKey(data.slice(3, 35)),
    rewardMint: new PublicKey(data.slice(35, 67)),
    stakeVault: new PublicKey(data.slice(67, 99)),
    rewardVault: new PublicKey(data.slice(99, 131)),
    rewardRate: readU64(data, 131),
    lastUpdate: readI64(data, 139),
    accRewardPerShare: readU128(data, 147),
    totalStaked: readU64(data, 163),
  };
}

export function decodeStakeState(data: Uint8Array): RewardsUserStakeState {
  if (data.length < STAKE_LEN || data[0] === 0) {
    return { amount: 0n, rewardDebt: 0n };
  }
  return {
    amount: readU64(data, 1),
    rewardDebt: readU128(data, 9),
  };
}

export async function getFarmState(
  connection: Connection,
  lpMint: PublicKey,
): Promise<{ farmPda: PublicKey; state: RewardsFarmState | null }> {
  const [farmPda] = getRewardsFarmPda(lpMint);
  const acc = await connection.getAccountInfo(farmPda);
  if (!acc?.data || acc.data.length < FARM_LEN) return { farmPda, state: null };
  return { farmPda, state: decodeFarmState(acc.data) };
}

export async function getUserStakeState(
  connection: Connection,
  farmPda: PublicKey,
  user: PublicKey,
): Promise<{ stakePda: PublicKey; state: RewardsUserStakeState }> {
  const [stakePda] = getRewardsStakePda(farmPda, user);
  const acc = await connection.getAccountInfo(stakePda);
  if (!acc?.data) return { stakePda, state: { amount: 0n, rewardDebt: 0n } };
  return { stakePda, state: decodeStakeState(acc.data) };
}

export function computePendingRewards(
  farm: RewardsFarmState,
  stake: RewardsUserStakeState,
  nowTs: bigint,
): bigint {
  let acc = farm.accRewardPerShare;
  if (farm.totalStaked > 0n && farm.rewardRate > 0n && nowTs > farm.lastUpdate) {
    const dt = nowTs - farm.lastUpdate;
    const reward = dt * farm.rewardRate;
    acc += (reward * ACC_PRECISION) / farm.totalStaked;
  }
  const gross = (stake.amount * acc) / ACC_PRECISION;
  return gross > stake.rewardDebt ? gross - stake.rewardDebt : 0n;
}

export function buildStakeIx(params: {
  farmPda: PublicKey;
  user: PublicKey;
  userLpAta: PublicKey;
  userRewardAta: PublicKey;
  stakePda: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  lpMint: PublicKey;
  rewardMint: PublicKey;
  tokenProgramLp: PublicKey;
  tokenProgramReward: PublicKey;
  amountRaw: bigint;
}): TransactionInstruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 5;
  writeU64(data, 1, params.amountRaw);
  return new TransactionInstruction({
    programId: REWARDS_PROGRAM_ID,
    keys: [
      { pubkey: params.farmPda, isSigner: false, isWritable: true },
      { pubkey: params.stakePda, isSigner: false, isWritable: true },
      { pubkey: params.user, isSigner: true, isWritable: false },
      { pubkey: params.userLpAta, isSigner: false, isWritable: true },
      { pubkey: params.userRewardAta, isSigner: false, isWritable: true },
      { pubkey: params.stakeVault, isSigner: false, isWritable: true },
      { pubkey: params.rewardVault, isSigner: false, isWritable: true },
      { pubkey: params.lpMint, isSigner: false, isWritable: false },
      { pubkey: params.rewardMint, isSigner: false, isWritable: false },
      { pubkey: params.tokenProgramLp, isSigner: false, isWritable: false },
      { pubkey: params.tokenProgramReward, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: params.user, isSigner: true, isWritable: true }, // payer
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function buildUnstakeIx(params: {
  farmPda: PublicKey;
  user: PublicKey;
  userLpAta: PublicKey;
  userRewardAta: PublicKey;
  stakePda: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  lpMint: PublicKey;
  rewardMint: PublicKey;
  tokenProgramLp: PublicKey;
  tokenProgramReward: PublicKey;
  amountRaw: bigint;
}): TransactionInstruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 6;
  writeU64(data, 1, params.amountRaw);
  return new TransactionInstruction({
    programId: REWARDS_PROGRAM_ID,
    keys: [
      { pubkey: params.farmPda, isSigner: false, isWritable: true },
      { pubkey: params.stakePda, isSigner: false, isWritable: true },
      { pubkey: params.user, isSigner: true, isWritable: false },
      { pubkey: params.userLpAta, isSigner: false, isWritable: true },
      { pubkey: params.userRewardAta, isSigner: false, isWritable: true },
      { pubkey: params.stakeVault, isSigner: false, isWritable: true },
      { pubkey: params.rewardVault, isSigner: false, isWritable: true },
      { pubkey: params.lpMint, isSigner: false, isWritable: false },
      { pubkey: params.rewardMint, isSigner: false, isWritable: false },
      { pubkey: params.tokenProgramLp, isSigner: false, isWritable: false },
      { pubkey: params.tokenProgramReward, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: params.user, isSigner: false, isWritable: false }, // payer (unused)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function buildClaimIx(params: {
  farmPda: PublicKey;
  stakePda: PublicKey;
  user: PublicKey;
  userRewardAta: PublicKey;
  rewardVault: PublicKey;
  rewardMint: PublicKey;
  tokenProgramReward: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: REWARDS_PROGRAM_ID,
    keys: [
      { pubkey: params.farmPda, isSigner: false, isWritable: true },
      { pubkey: params.stakePda, isSigner: false, isWritable: true },
      { pubkey: params.user, isSigner: true, isWritable: false },
      { pubkey: params.userRewardAta, isSigner: false, isWritable: true },
      { pubkey: params.rewardVault, isSigner: false, isWritable: true },
      { pubkey: params.rewardMint, isSigner: false, isWritable: false },
      { pubkey: params.tokenProgramReward, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([7]),
  });
}

export async function buildCreateAtaIxIfMissing(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  mintTokenProgram: PublicKey,
): Promise<{ ata: PublicKey; ix: TransactionInstruction | null }> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    mintTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const acc = await connection.getAccountInfo(ata);
  if (acc) return { ata, ix: null };
  const ix = createAssociatedTokenAccountInstruction(
    owner,
    ata,
    owner,
    mint,
    mintTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return { ata, ix };
}
