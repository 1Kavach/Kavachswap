/**
 * Jupiter swap v6 — quote + unsigned swap transaction.
 * Optional protocol fee: `platformFeeBps` on quote + `feeAccount` on swap (treasury ATA for output mint).
 */
import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { JUPITER_PLATFORM_FEE_BPS_DEFAULT, PROTOCOL_TREASURY } from "./constants";

const JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_URL = "https://quote-api.jup.ag/v6/swap";

/** Jupiter historically caps integrator fee (keep conservative). */
const JUPITER_PLATFORM_FEE_BPS_MAX = 255;

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  /** If set (including 0), used for quote. If omitted, uses `getJupiterPlatformFeeBps()`. */
  platformFeeBps?: number;
}

/** Single step in Jupiter route (v6). */
export interface JupiterRouteStep {
  swapInfo?: { label?: string; ammKey?: string };
  percent?: number;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  /** Min amount out (slippage applied). */
  otherAmountThreshold: string;
  swapMode: string;
  routePlan: JupiterRouteStep[];
  /** Price impact as string e.g. "0.01" for 0.01%. */
  priceImpactPct?: string;
}

function readEnvJupiterPlatformFeeBps(): number | undefined {
  if (typeof import.meta === "undefined" || !import.meta.env?.VITE_JUPITER_PLATFORM_FEE_BPS) {
    return undefined;
  }
  const raw = String(import.meta.env.VITE_JUPITER_PLATFORM_FEE_BPS).trim();
  if (raw === "") return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/**
 * Configured Jupiter platform fee (bps). `VITE_JUPITER_PLATFORM_FEE_BPS=0` disables.
 * Clamped to `JUPITER_PLATFORM_FEE_BPS_MAX`.
 */
export function getJupiterPlatformFeeBps(): number {
  const fromEnv = readEnvJupiterPlatformFeeBps();
  const base =
    fromEnv !== undefined ? fromEnv : JUPITER_PLATFORM_FEE_BPS_DEFAULT;
  if (base <= 0) return 0;
  return Math.min(JUPITER_PLATFORM_FEE_BPS_MAX, base);
}

/**
 * Effective fee bps for this output mint: 0 if mint missing or not SPL / Token-2022.
 * Use the same value for quote + swap so Jupiter stays consistent.
 */
export async function effectiveJupiterPlatformFeeBps(
  connection: Connection,
  outputMint: string
): Promise<number> {
  const base = getJupiterPlatformFeeBps();
  if (base <= 0) return 0;
  try {
    const mint = new PublicKey(outputMint);
    const info = await connection.getAccountInfo(mint, "confirmed");
    if (!info) return 0;
    if (
      !info.owner.equals(TOKEN_PROGRAM_ID) &&
      !info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ) {
      return 0;
    }
    return Math.min(JUPITER_PLATFORM_FEE_BPS_MAX, base);
  } catch {
    return 0;
  }
}

export async function getJupiterQuote(
  params: JupiterQuoteParams
): Promise<JupiterQuote | null> {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 100));

  const feeBps =
    params.platformFeeBps !== undefined
      ? params.platformFeeBps
      : getJupiterPlatformFeeBps();
  if (feeBps > 0) {
    url.searchParams.set(
      "platformFeeBps",
      String(Math.min(JUPITER_PLATFORM_FEE_BPS_MAX, feeBps))
    );
  }

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  return (await res.json()) as JupiterQuote;
}

async function feeAccountForOutputMint(
  connection: Connection,
  outputMint: string
): Promise<string | null> {
  const mint = new PublicKey(outputMint);
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) return null;
  if (
    !info.owner.equals(TOKEN_PROGRAM_ID) &&
    !info.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    return null;
  }
  const treasury = new PublicKey(PROTOCOL_TREASURY);
  const ata = getAssociatedTokenAddressSync(
    mint,
    treasury,
    false,
    info.owner,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.toBase58();
}

export async function getJupiterSwapTransaction(params: {
  connection: Connection;
  quote: JupiterQuote;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  /** Must match the `platformFeeBps` used when fetching `quote`. */
  platformFeeBps?: number;
}): Promise<string | null> {
  const feeBps =
    params.platformFeeBps !== undefined
      ? params.platformFeeBps
      : getJupiterPlatformFeeBps();

  let feeAccount: string | undefined;
  if (feeBps > 0) {
    const acct = await feeAccountForOutputMint(
      params.connection,
      params.quote.outputMint
    );
    if (acct) feeAccount = acct;
  }

  const body: Record<string, unknown> = {
    quoteResponse: params.quote,
    userPublicKey: params.userPublicKey,
    wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
  };
  if (feeAccount) {
    body.feeAccount = feeAccount;
  }

  const res = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.swapTransaction ?? null;
}

export function deserializeJupiterTx(serialized: string): Transaction {
  const binary = atob(serialized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Transaction.from(bytes);
}
