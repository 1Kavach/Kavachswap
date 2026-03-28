import { SolanaProvider } from "@solana/react-hooks";
import { PropsWithChildren } from "react";
import { autoDiscover, createClient } from "@solana/client";
import { getSolanaRpcUrl } from "./lib/connection";

/** Must match `getConnection()` in lib/connection.ts (same default devnet RPC when env unset). */
const client = createClient({
  endpoint: getSolanaRpcUrl(),
  walletConnectors: autoDiscover(),
});

export function Providers({ children }: PropsWithChildren) {
  return <SolanaProvider client={client}>{children}</SolanaProvider>;
}
