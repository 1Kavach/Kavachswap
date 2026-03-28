/**
 * RPC + mints. Swap via Jupiter, create via SPL.
 */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Protocol token mint */
export const KAVACH_MINT = "AJkyUCFTRD8113aFeaJxTvLKHAEtsheb6jAXLmsx2sh7";

/**
 * Kavach Router program ID. Keypair: programs/kavach_router/target/deploy/kavach_router-keypair.json.
 * RouteAndSwapMultiHop (discriminator 3): 20 accounts if both hops are non-Stable; +2 after hop1 mints if `amm_id_1 === 1` (Stable fee ATAs); +2 after hop2 mints if `amm_id_2 === 1`.
 */
export const KAVACH_ROUTER_PROGRAM_ID = "611Zw3DdKegJN3F3BJ6F9nGsCngTMMSsKzWdFdwSKEpR";

/** Kavach Core AMM program ID (constant-product, Token-2022). Use this for AMM-only: Create Pool, Add Liquidity, Swap — no router needed. */
export const KAVACH_AMM_CORE_PROGRAM_ID = "9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM";

/** Kavach Stable AMM — same program id on devnet + mainnet (see 126/files/soldexplex.md). */
export const KAVACH_STABLE_AMM_PROGRAM_ID = "G5WXPHKZqzCdCZcM9BkmSFqdbxvKFqTjR6m3hZdozAGi";

/** Kavach Rewards program (on-chain staking; devnet). */
export const KAVACH_REWARDS_PROGRAM_ID = "BMLfK24sFBCsTfqX6ArzXahgZMcaMEaoXri97hbuqh5Q";

/** Devnet-only test SPL mint (pool / swap testing). */
export const DEVNET_TEST_SPL_MINT = "7KZGxjT8xEqsqRKa14XMEqVw8aMxSH1wGny3hXBUFnua";

/** KVUSD devnet mint (from kvusd deployment log). */
export const KVUSD_DEVNET_MINT = "3oGy6pzZ1N53yJHBDFCza82hW1hCKaV2dE29FZsLC9LF";
/** Preferred naming in UI/docs: KVS. */
export const KVS_DEVNET_MINT = KVUSD_DEVNET_MINT;

/** Protocol treasury — receives token-creation fee, pool-creation fee, and (later) AMM protocol share. Fees land here; you can manually send to multisig when desired. */
export const PROTOCOL_TREASURY = "BvUzpcTUVptB4TZHDj5LmerZTyRfV845YYik19fXNpXJ";

/**
 * Jupiter swap integrator fee (basis points taken from swap **output**), paid to
 * `PROTOCOL_TREASURY`'s ATA for that output mint. Set `VITE_JUPITER_PLATFORM_FEE_BPS=0` to disable.
 * @see https://station.jup.ag/docs/apis/swap-api (platformFeeBps + feeAccount)
 */
export const JUPITER_PLATFORM_FEE_BPS_DEFAULT = 20;

/** Multisig — not used by the app. Send from PROTOCOL_TREASURY to this address manually when you want to lock funds. */
export const MULTISIG_TREASURY = "12tuVUnX6kiK5KGWybSoB97Yb4jKnXTodYGN9Ngn6srK";

/**
 * Token creation fee: either fixed SOL or percentage of SOL spent in the tx.
 *
 * Option 1 — Fixed: set TOKEN_CREATION_FEE_BPS = 0 and use TOKEN_CREATION_FEE_LAMPORTS (e.g. 16_000_000 = 0.016 SOL).
 * Option 2 — Percentage: set TOKEN_CREATION_FEE_BPS (e.g. 200 = 2% of rent). Fee = (mint rent + ATA rent) * BPS / 10_000, clamped to min/max.
 */
export const TOKEN_CREATION_FEE_LAMPORTS = 16_000_000;

/** Token creation fee in basis points (10000 = 100%). If > 0, fee = (rent in tx) * BPS / 10_000, clamped to min/max below. */
export const TOKEN_CREATION_FEE_BPS = 0;

/** When using BPS: minimum protocol fee lamports (e.g. 1_000_000 = 0.001 SOL). */
export const TOKEN_CREATION_FEE_MIN_LAMPORTS = 1_000_000;

/** When using BPS: maximum protocol fee lamports (e.g. 50_000_000 = 0.05 SOL). */
export const TOKEN_CREATION_FEE_MAX_LAMPORTS = 50_000_000;

/** Fee schedule: all paid by the user. Create is used now; others for future flows. */
export const TOKEN_FEE_SCHEDULE = {
  create: 16_000_000,    // 0.016 SOL (used when BPS = 0)
  metadata: 1_000_000,   // 0.001 SOL
  freeze: 1_000_000,     // 0.001 SOL
  mintRevoke: 1_000_000, // 0.001 SOL
} as const;

/**
 * Revoke authority fees (protocol treasury).
 * Cheapest (update/metadata): 0.006 SOL. Mint and freeze: 0.01 SOL each. All 3: 0.02 SOL bundle.
 */
export const REVOKE_MINT_FEE_LAMPORTS = 10_000_000;     // 0.01 SOL
export const REVOKE_FREEZE_FEE_LAMPORTS = 10_000_000;   // 0.01 SOL
export const REVOKE_UPDATE_FEE_LAMPORTS = 6_000_000;    // 0.006 SOL (cheapest)
export const REVOKE_ALL_AUTHORITIES_FEE_LAMPORTS = 20_000_000; // 0.02 SOL bundle (all 3)

/**
 * Pool creation fees (lamports) per AMM type.
 * 0 = user pays rent only. If > 0, frontend adds transfer to PROTOCOL_TREASURY before initialize_pool.
 * LPs always pay rent (~0.005–0.006 SOL for 8tier/Core); this is the extra protocol fee.
 */
/** Pool creation protocol fee per AMM. Everyone pays. */
export const POOL_CREATION_FEE_LAMPORTS = {
  core: 20_000_000,   // 0.02 SOL
  tier8: 16_000_000,  // 0.016 SOL (waived if either mint is creator)
  stable: 20_000_000, // 0.02 SOL
  clmm: 20_000_000,   // 0.02 SOL
} as const;

/**
 * Pool creation fee as percentage of rent (basis points).
 * If > 0 for an AMM, frontend computes: fee = rent_lamports * BPS / 10_000, clamps to POOL_CREATION_FEE_MIN/MAX_LAMPORTS, adds transfer before init.
 */
export const POOL_CREATION_FEE_BPS: Record<keyof typeof POOL_CREATION_FEE_LAMPORTS, number> = {
  core: 0,   // e.g. 100 = 1% of pool init rent
  tier8: 0,
  stable: 0,
  clmm: 0,
};

export const POOL_CREATION_FEE_MIN_LAMPORTS = 0;
export const POOL_CREATION_FEE_MAX_LAMPORTS = 100_000_000; // 0.1 SOL cap

export const KNOWN_MINTS: Record<string, string> = {
  WSOL: WSOL_MINT,
  SOL: WSOL_MINT,
  KVH: KAVACH_MINT,
};

export const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  WSOL: 9,
  KVH: 6,
};
