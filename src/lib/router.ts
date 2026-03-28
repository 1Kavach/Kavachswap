import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "./connection";
import {
  KAVACH_AMM_CORE_PROGRAM_ID,
  KAVACH_ROUTER_PROGRAM_ID,
} from "./constants";
import type { PoolState } from "./ammCore";

const ROUTER_PROGRAM_ID = new PublicKey(KAVACH_ROUTER_PROGRAM_ID);
const CORE_PROGRAM_ID = new PublicKey(KAVACH_AMM_CORE_PROGRAM_ID);

function writeU64(buf: Uint8Array, offset: number, val: number): void {
  const v = BigInt(val);
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number((v >> BigInt(i * 8)) & 0xffn);
  }
}

function writeBool(buf: Uint8Array, offset: number, val: boolean): void {
  buf[offset] = val ? 1 : 0;
}

export function getRouterConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], ROUTER_PROGRAM_ID);
}

export interface RouterConfigState {
  isInitialized: boolean;
  authority: PublicKey;
  ammProgramIds: [PublicKey, PublicKey, PublicKey, PublicKey];
}

export async function getRouterConfigState(): Promise<RouterConfigState | null> {
  const connection = getConnection();
  const [configPda] = getRouterConfigPda();
  const acc = await connection.getAccountInfo(configPda);
  if (!acc?.data || acc.data.length < 161) return null;
  const data = new Uint8Array(acc.data);
  const isInitialized = data[0] !== 0;
  if (!isInitialized) return null;
  const authority = new PublicKey(data.slice(1, 33));
  const amm0 = new PublicKey(data.slice(33, 65));
  const amm1 = new PublicKey(data.slice(65, 97));
  const amm2 = new PublicKey(data.slice(97, 129));
  const amm3 = new PublicKey(data.slice(129, 161));
  return {
    isInitialized,
    authority,
    ammProgramIds: [amm0, amm1, amm2, amm3],
  };
}

export async function canUseRouterForCoreSwap(): Promise<boolean> {
  const cfg = await getRouterConfigState();
  if (!cfg || !cfg.isInitialized) return false;
  return cfg.ammProgramIds[3].equals(CORE_PROGRAM_ID);
}

/**
 * Build single-hop Router RouteAndSwap instruction for Core (slot 3).
 * Account order mirrors programs/kavach_router/src/instruction.rs.
 */
export function buildRouterCoreSwapIx(params: {
  poolPda: PublicKey;
  poolState: PoolState;
  user: PublicKey;
  amountIn: number;
  minAmountOut: number;
  aToB: boolean;
}): TransactionInstruction {
  const { poolPda, poolState, user, amountIn, minAmountOut, aToB } = params;
  const [configPda] = getRouterConfigPda();
  const vaultIn = aToB ? poolState.tokenAVault : poolState.tokenBVault;
  const vaultOut = aToB ? poolState.tokenBVault : poolState.tokenAVault;
  const userTokenIn = getAssociatedTokenAddressSync(
    aToB ? poolState.tokenAMint : poolState.tokenBMint,
    user,
  );
  const userTokenOut = getAssociatedTokenAddressSync(
    aToB ? poolState.tokenBMint : poolState.tokenAMint,
    user,
  );

  const data = new Uint8Array(1 + 8 + 8 + 1 + 1);
  data[0] = 1; // RouteAndSwap
  writeU64(data, 1, amountIn);
  writeU64(data, 9, minAmountOut);
  data[17] = 3; // Core slot in RouterConfig
  writeBool(data, 18, aToB);

  return new TransactionInstruction({
    programId: ROUTER_PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: vaultIn, isSigner: false, isWritable: true },
      { pubkey: vaultOut, isSigner: false, isWritable: true },
      { pubkey: userTokenIn, isSigner: false, isWritable: true },
      { pubkey: userTokenOut, isSigner: false, isWritable: true },
      { pubkey: poolState.tokenAMint, isSigner: false, isWritable: false },
      { pubkey: poolState.tokenBMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}
