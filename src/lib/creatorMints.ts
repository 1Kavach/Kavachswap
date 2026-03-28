/**
 * Pool creation fee helper. Everyone pays; no waiver.
 * Use when building the Create Pool tx: add SystemProgram.transfer to PROTOCOL_TREASURY before initialize_pool.
 */
import { POOL_CREATION_FEE_LAMPORTS } from "./constants";

export type AmmType = keyof typeof POOL_CREATION_FEE_LAMPORTS;

/**
 * Pool creation fee in lamports for the given AMM type.
 * When building Create Pool tx: if > 0, add transfer to PROTOCOL_TREASURY then initialize_pool.
 */
export function getPoolCreationFeeLamports(ammType: AmmType): number {
  return POOL_CREATION_FEE_LAMPORTS[ammType];
}
