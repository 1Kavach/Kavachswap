/**
 * Get SOL links and placeholder for future ramp (e.g. KVS stablecoin).
 * No third-party fiat ramp in use; spot reserved for your own stable link later.
 */

/** Links to get SOL (faucet, get started). */
export const GET_SOL_LINKS = [
  { label: "Solana Get Started", url: "https://solana.com/get-started" },
  { label: "Devnet Faucet", url: "https://faucet.solana.com" },
] as const;

/** Reserved spot: link to your stable (KVS) when ready. Set url when live. */
export const STABLE_LINK = {
  label: "Stable (KVS)",
  url: "" as string,
  comingSoon: true,
} as const;
