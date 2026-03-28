import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getConnection } from "../lib/connection";
import { signAndSendTransaction } from "../lib/send";
import {
  buildClaimIx,
  buildCreateAtaIxIfMissing,
  buildStakeIx,
  buildUnstakeIx,
  computePendingRewards,
  getFarmState,
  getUserStakeState,
} from "../lib/rewards";

function fmtAmount(raw: bigint, decimals: number): string {
  if (decimals < 0) return raw.toString();
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

export default function RewardsCard() {
  const { wallet, status } = useWalletConnection();
  const connection = getConnection();
  const walletAddress = wallet?.account?.address?.toString() ?? "";

  const [lpMintInput, setLpMintInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txOk, setTxOk] = useState<boolean | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [farmExists, setFarmExists] = useState(false);
  const [farmPaused, setFarmPaused] = useState(false);
  const [rewardMint, setRewardMint] = useState<string>("");
  const [stakedRaw, setStakedRaw] = useState<bigint>(0n);
  const [pendingRaw, setPendingRaw] = useState<bigint>(0n);
  const [lpDecimals, setLpDecimals] = useState(0);
  const [rewardDecimals, setRewardDecimals] = useState(0);

  const lpMintPk = useMemo(() => {
    try {
      return lpMintInput.trim() ? new PublicKey(lpMintInput.trim()) : null;
    } catch {
      return null;
    }
  }, [lpMintInput]);

  const refresh = useCallback(async () => {
    if (!lpMintPk || !walletAddress) {
      setFarmExists(false);
      setPendingRaw(0n);
      setStakedRaw(0n);
      return;
    }
    try {
      const user = new PublicKey(walletAddress);
      const { farmPda, state: farm } = await getFarmState(connection, lpMintPk);
      if (!farm) {
        setFarmExists(false);
        setPendingRaw(0n);
        setStakedRaw(0n);
        setRewardMint("");
        return;
      }
      const { state: stake } = await getUserStakeState(connection, farmPda, user);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const pending = computePendingRewards(farm, stake, now);

      const [lpMintAcc, rewardMintAcc] = await Promise.all([
        connection.getParsedAccountInfo(lpMintPk),
        connection.getParsedAccountInfo(farm.rewardMint),
      ]);
      const lpParsed = lpMintAcc.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined;
      const rwParsed = rewardMintAcc.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined;

      setFarmExists(true);
      setFarmPaused(farm.paused);
      setRewardMint(farm.rewardMint.toBase58());
      setStakedRaw(stake.amount);
      setPendingRaw(pending);
      setLpDecimals(lpParsed?.parsed?.info?.decimals ?? 0);
      setRewardDecimals(rwParsed?.parsed?.info?.decimals ?? 0);
    } catch (e) {
      console.error("Rewards refresh failed", e);
      setFarmExists(false);
    }
  }, [connection, lpMintPk, walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  const sendRewardsTx = useCallback(async (action: "stake" | "claim" | "unstake") => {
    if (!walletAddress || !wallet) return;
    if (!lpMintPk) {
      setTxStatus("Invalid LP mint");
      setTxOk(false);
      return;
    }
    try {
      setLoading(true);
      setTxOk(null);
      setTxStatus(`Preparing ${action}...`);

      const user = new PublicKey(walletAddress);
      const { farmPda, state: farm } = await getFarmState(connection, lpMintPk);
      if (!farm) throw new Error("Farm not found for LP mint");

      const lpMintInfo = await connection.getAccountInfo(farm.lpMint);
      const rewardMintInfo = await connection.getAccountInfo(farm.rewardMint);
      if (!lpMintInfo || !rewardMintInfo) throw new Error("LP/reward mint account missing");
      const tokenProgramLp = lpMintInfo.owner;
      const tokenProgramReward = rewardMintInfo.owner;

      const { stakePda } = await getUserStakeState(connection, farmPda, user);
      const userLpAtaInfo = await buildCreateAtaIxIfMissing(connection, user, farm.lpMint, tokenProgramLp);
      const userLpAta = userLpAtaInfo.ata;
      const rewardAtaInfo = await buildCreateAtaIxIfMissing(connection, user, farm.rewardMint, tokenProgramReward);

      const tx = new Transaction();
      if (rewardAtaInfo.ix) tx.add(rewardAtaInfo.ix);
      if (action === "stake" && userLpAtaInfo.ix) tx.add(userLpAtaInfo.ix);

      if (action === "stake" || action === "unstake") {
        const parsed = parseFloat(amountInput);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Enter a valid amount");
        const amountRaw = BigInt(Math.floor(parsed * 10 ** lpDecimals));
        if (amountRaw <= 0n) throw new Error("Amount too small");
        tx.add(
          action === "stake"
            ? buildStakeIx({
              farmPda,
              user,
              userLpAta,
              userRewardAta: rewardAtaInfo.ata,
              stakePda,
              stakeVault: farm.stakeVault,
              rewardVault: farm.rewardVault,
              lpMint: farm.lpMint,
              rewardMint: farm.rewardMint,
              tokenProgramLp,
              tokenProgramReward,
              amountRaw,
            })
            : buildUnstakeIx({
              farmPda,
              user,
              userLpAta,
              userRewardAta: rewardAtaInfo.ata,
              stakePda,
              stakeVault: farm.stakeVault,
              rewardVault: farm.rewardVault,
              lpMint: farm.lpMint,
              rewardMint: farm.rewardMint,
              tokenProgramLp,
              tokenProgramReward,
              amountRaw,
            }),
        );
      } else {
        tx.add(buildClaimIx({
          farmPda,
          stakePda,
          user,
          userRewardAta: rewardAtaInfo.ata,
          rewardVault: farm.rewardVault,
          rewardMint: farm.rewardMint,
          tokenProgramReward,
        }));
      }

      const sig = await signAndSendTransaction({
        connection,
        wallet: {
          address: walletAddress,
          features: (wallet as { features?: Record<string, unknown> }).features ?? {},
        },
        transaction: tx,
      });
      setTxStatus(`${action} success: ${sig.slice(0, 16)}...`);
      setTxOk(true);
      setRefreshTick((x) => x + 1);
    } catch (e) {
      console.error(`Rewards ${action} failed`, e);
      setTxStatus(`${action} failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setTxOk(false);
    } finally {
      setLoading(false);
    }
  }, [amountInput, connection, lpDecimals, lpMintPk, wallet, walletAddress]);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-3 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-lg font-semibold">Rewards</p>
        <p className="text-sm text-muted">Connect wallet to stake, claim, and unstake rewards.</p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold">Rewards</p>
        <button
          type="button"
          onClick={() => setRefreshTick((x) => x + 1)}
          className="rounded-lg border border-border-low px-3 py-1.5 text-sm hover:bg-muted/20"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-border-low bg-muted/10 p-3 space-y-2">
        <label className="block text-xs font-medium text-muted">LP mint (farm key)</label>
        <input
          type="text"
          value={lpMintInput}
          onChange={(e) => setLpMintInput(e.target.value)}
          placeholder="Paste LP mint used by rewards farm"
          className="w-full rounded-lg border border-border-low bg-background px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs text-muted">
          Rewards farm PDA is derived as ["farm", lp_mint]. Use the LP mint for the pool you want to stake.
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <div className="flex justify-between"><span className="text-muted">Farm</span><span>{farmExists ? "Active" : "Not found"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Paused</span><span>{farmPaused ? "Yes" : "No"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Reward mint</span><span className="font-mono text-xs">{rewardMint || "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Your staked LP</span><span>{fmtAmount(stakedRaw, lpDecimals)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Pending rewards</span><span>{fmtAmount(pendingRaw, rewardDecimals)}</span></div>
      </div>

      <div className="rounded-xl border border-border-low bg-muted/10 p-3 space-y-2">
        <label className="block text-xs font-medium text-muted">Amount (LP)</label>
        <input
          type="number"
          min={0}
          step="any"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="0.0"
          className="w-full rounded-lg border border-border-low bg-background px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            disabled={loading || !farmExists || farmPaused}
            onClick={() => void sendRewardsTx("stake")}
            className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40"
          >
            {loading ? "Working..." : "Stake"}
          </button>
          <button
            type="button"
            disabled={loading || !farmExists}
            onClick={() => void sendRewardsTx("claim")}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {loading ? "Working..." : "Claim"}
          </button>
          <button
            type="button"
            disabled={loading || !farmExists || farmPaused}
            onClick={() => void sendRewardsTx("unstake")}
            className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          >
            {loading ? "Working..." : "Unstake"}
          </button>
        </div>
      </div>

      {txStatus && (
        <div className={`rounded-lg px-3 py-2 text-sm ${
          txOk === true ? "bg-emerald-500/15 text-emerald-500" :
            txOk === false ? "bg-red-500/15 text-red-500" : "bg-muted/30 text-muted"
        }`}>
          {txStatus}
        </div>
      )}
    </section>
  );
}
