import { useState, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import SwapCard from "./components/SwapCard";
import StableSwapCard from "./components/StableSwapCard";
import LiquidityCard from "./components/LiquidityCard";
import PoolsCard from "./components/PoolsCard";
import CreatePoolCard from "./components/CreatePoolCard";
import CreateTokenCard from "./components/CreateTokenCard";
import LaunchTokenCard from "./components/LaunchTokenCard";
import AirdropCard from "./components/AirdropCard";
import PortfolioCard from "./components/PortfolioCard";
import RewardsCard from "./components/RewardsCard";

const TABS = [
  { id: "swap", label: "Swap" },
  { id: "stable", label: "Stable" },
  { id: "liquidity", label: "Add Liquidity" },
  { id: "pools", label: "Pools" },
  { id: "createpool", label: "Create Pool" },
  { id: "factory", label: "Token Factory" },
  { id: "launch", label: "Launch Token" },
  { id: "rewards", label: "Rewards" },
  { id: "portfolio", label: "Portfolio" },
  { id: "airdrop", label: "Airdrop" },
] as const;

function getInitialTab(): (typeof TABS)[number]["id"] {
  if (typeof window === "undefined") return "swap";
  const hash = window.location.hash.slice(1).toLowerCase();
  if (hash === "portfolio") return "portfolio";
  const match = TABS.find((t) => t.id === hash);
  return match ? match.id : "swap";
}

export default function App() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>(() => getInitialTab());

  useEffect(() => {
    const onHash = () => setActiveTab(getInitialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const address = wallet?.account.address.toString();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col gap-10 border-x-2 border-orange-500/30 px-6 py-16" style={{ borderLeftColor: "rgba(16,185,129,0.4)", borderRightColor: "rgba(249,115,22,0.4)" }}>
        <header className="space-y-3 rounded-xl border-2 border-orange-500/20 bg-card/50 px-5 py-4" style={{ borderTopColor: "rgba(249,115,22,0.35)", borderBottomColor: "rgba(16,185,129,0.35)", boxShadow: "inset 0 1px 0 rgba(249,115,22,0.08), 0 0 0 1px rgba(16,185,129,0.06)" }}>
          <div className="flex items-center gap-3">
            <img
              src="https://tomato-impossible-warbler-875.mypinata.cloud/ipfs/bafybeih2v2caps7rsz27xxez7i5eh2tfolhiivyrddk5city2objtrgpim"
              alt="Kavachswap"
              className="h-12 w-12 rounded-lg object-cover ring-2"
              style={{ boxShadow: "0 0 0 2px rgba(16,185,129,0.6), 0 0 12px rgba(16,185,129,0.25)" }}
            />
            <div className="flex-1 border-l-2 border-green-500/30 pl-3" style={{ borderColor: "rgba(16,185,129,0.4)" }}>
              <h1
                className="text-4xl font-bold tracking-wide"
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  letterSpacing: "0.02em",
                  background: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #8b5cf6, #ec4899)",
                  backgroundSize: "200% auto",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  textShadow: "none",
                  filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.3)) drop-shadow(0 4px 4px rgba(0,0,0,0.2))",
                }}
              >
                KAVACHSWAP
              </h1>
              <p className="text-sm text-muted mt-0.5" style={{ fontFamily: "'Briem Hand', cursive" }}>
                DEX • Swap • Create Token • Launch
              </p>
            </div>
            <a
              href="index.html"
              className="shrink-0 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm font-medium text-green hover:bg-green-500/20"
              style={{ fontFamily: "'Briem Hand', cursive" }}
            >
              Dashboard
            </a>
          </div>
        </header>

        <section className="w-full max-w-3xl space-y-4 rounded-2xl border-2 border-border-low bg-card p-6" style={{ borderColor: "rgba(249,115,22,0.2)", borderBottomColor: "rgba(16,185,129,0.25)", boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.05)" }}>
          <div className="flex items-center justify-between border-b border-orange-500/20 pb-3" style={{ borderColor: "rgba(249,115,22,0.25)" }}>
            <p className="text-lg font-semibold" style={{ fontFamily: "'Briem Hand', cursive" }}>Wallet</p>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                status === "connected"
                  ? "bg-green/30 text-green"
                  : "bg-muted text-muted"
              }`}
              style={{ fontFamily: "'Briem Hand', cursive" }}
            >
              {status === "connected" ? "Connected" : "Not connected"}
            </span>
          </div>
          {connectors.length === 0 ? (
            <div className="rounded-lg border-2 border-amber-500/30 bg-amber-500/10 p-4 text-sm" style={{ borderLeftColor: "rgba(249,115,22,0.4)" }}>
              <p className="font-medium text-foreground" style={{ fontFamily: "'Briem Hand', cursive" }}>Phantom (or another Solana wallet) not detected</p>
              <p className="mt-1 text-muted" style={{ fontFamily: "'Briem Hand', cursive" }}>
                Install Phantom from <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" className="underline">phantom.app</a>, then{" "}
                <strong>open this app at a proper URL</strong>: run <code className="rounded bg-card px-1">npm run dev</code> and go to{" "}
                <code className="rounded bg-card px-1">http://localhost:5173/app.html</code>, or use your hosted site. Do not open the HTML file directly (file://) — wallets do not inject there.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3" style={{ fontFamily: "'Briem Hand', cursive" }}>
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => connect(connector.id)}
                  disabled={status === "connecting"}
                  className="rounded-lg border-2 border-green-500/20 bg-card px-4 py-2 text-sm font-medium transition hover:bg-orange/20 hover:border-orange-500/30 disabled:opacity-60"
                  style={{ borderColor: "rgba(16,185,129,0.3)" }}
                >
                  {connector.name}
                </button>
              ))}
              <span className="font-mono text-xs text-muted">
                {address ? `${address.slice(0, 8)}...${address.slice(-8)}` : "—"}
              </span>
              <button
                onClick={() => disconnect()}
                disabled={status !== "connected"}
                className="rounded-lg border-2 border-orange/50 px-3 py-2 text-sm text-foreground disabled:opacity-40 hover:bg-orange/10"
              >
                Disconnect
              </button>
            </div>
          )}
        </section>

        <div className="dex-tab-bar flex flex-wrap gap-2 p-3 bg-card/50">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition border-2 ${
                activeTab === tab.id
                  ? "bg-orange text-white border-orange-500"
                  : "bg-card hover:bg-orange/20 text-foreground border-green-500/30"
              }`}
              style={activeTab === tab.id ? {} : { borderColor: "rgba(16,185,129,0.4)" }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div data-dex-content>
        {activeTab === "swap" && <SwapCard />}
        {activeTab === "stable" && <StableSwapCard />}
        {activeTab === "liquidity" && <LiquidityCard />}
        {activeTab === "pools" && <PoolsCard />}
        {activeTab === "createpool" && <CreatePoolCard />}
        {activeTab === "factory" && <CreateTokenCard />}
        {activeTab === "launch" && <LaunchTokenCard />}
        {activeTab === "rewards" && <RewardsCard />}
        {activeTab === "portfolio" && <PortfolioCard />}
        {activeTab === "airdrop" && <AirdropCard />}
        </div>

        <footer className="mt-12 border-t border-border-low pt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
          <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Terms</a>
          <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Privacy</a>
          <a href="/risk-disclosure.html" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Risk Disclosure</a>
          <a href="/non-custodial-statement.html" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Non-Custodial</a>
          <a href="/verifiable-builds.html" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Verifiable Builds</a>
        </footer>
      </main>
    </div>
  );
}
