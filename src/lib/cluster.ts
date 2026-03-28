/**
 * Build-time cluster hint. Set VITE_CLUSTER=devnet or VITE_CLUSTER=mainnet-beta, or rely on VITE_SOLANA_RPC URL.
 */
export function isDevnetBuild(): boolean {
  const cluster = import.meta.env?.VITE_CLUSTER?.trim();
  if (cluster === "devnet" || cluster === "local-devnet") return true;
  if (cluster === "mainnet-beta" || cluster === "mainnet") return false;
  const rpc = import.meta.env?.VITE_SOLANA_RPC?.trim() ?? "";
  if (rpc.includes("devnet")) return true;
  if (rpc.includes("mainnet") || rpc.includes("helius") || rpc.includes("chainstack")) return false;
  return true;
}
