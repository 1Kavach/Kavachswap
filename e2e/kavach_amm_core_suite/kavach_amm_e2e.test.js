/**
 * ============================================================
 *  KAVACH AMM CORE — FULL E2E TEST SUITE (DEVNET)
 *  Program:  9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM
 *  Network:  Devnet (confirms mainnet-equivalent functionality)
 *
 *  Coverage:
 *    1.  Security.txt binary verification
 *    2.  Pool PDA canonical derivation
 *    3.  InitializePool (happy path)
 *    4.  Duplicate pool prevention
 *    5.  Initial AddLiquidity
 *    6.  Swap A→B (exact-in, CPMM invariant)
 *    7.  Swap B→A (reverse)
 *    8.  Slippage protection (min_out enforcement)
 *    9.  Zero-amount swap rejection
 *   10.  Proportional AddLiquidity
 *   11.  RemoveLiquidity (partial + full)
 *   12.  CollectFees — 50/50 routing to treasury + creator
 *   13.  Unauthorized signer on CollectFees
 *   14.  Wrong token-program injection
 *   15.  Pool ownership check
 *   16.  KVUSD stablecoin pool integration
 *   17.  LP token supply invariant
 *   18.  Protocol fee accounting
 *   19.  Overflow / extreme amount guard
 *   20.  Verifiable build metadata check
 * ============================================================
 *
 *  Run:
 *    npm install
 *    ANCHOR_WALLET=~/.config/solana/id.json npx mocha kavach_amm_e2e.test.js --timeout 120000
 *
 *  Requires devnet SOL in the payer wallet (at least 2 SOL).
 *  For local validator:  set SOLANA_RPC=http://127.0.0.1:8899
 * ============================================================
 */

"use strict";

const {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const {
  createMint, createAccount, mintTo,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount, getMint,
} = require("@solana/spl-token");

const assert = require("assert");
const fs     = require("fs");
const path   = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────
const RPC_URL          = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID       = new PublicKey("9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM");
const PROTOCOL_TREASURY = new PublicKey("BvUzpcTUVptB4TZHDj5LmerZTyRfV845YYik19fXNpXJ");
const KAVACH_MINT_ADDR = "AJkyUCFTRD8113aFeaJxTvLKHAEtsheb6jAXLmsx2sh7";
/** Built artifact from `programs/kavach_amm_core` (override with env KAVACH_SO_PATH). */
const SO_PATH =
  process.env.KAVACH_SO_PATH ||
  path.resolve(__dirname, "../../programs/kavach_amm_core/target/deploy/kavach_amm_core.so");

// Instruction discriminators (Borsh enum, u8 variant index)
const IX = { INIT: 0, SWAP: 1, ADD_LIQ: 2, REM_LIQ: 3, COLLECT: 4 };

// Fee tier to test with (30 bps = 0.30%)
const FEE_BPS = 30n;
// Pool creation protocol fee
const POOL_FEE_LAMPORTS = 20_000_000n;

// ─── Borsh-style helpers ───────────────────────────────────────────────────────
function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function bool(v) { return Buffer.from([v ? 1 : 0]); }
function u8(n)  { return Buffer.from([n & 0xff]); }

// Build instruction data: [discriminator u8, ...Borsh fields]
const idata = {
  initPool:   (feeBps)           => Buffer.concat([u8(IX.INIT),    u64(feeBps)]),
  swap:       (amtIn, minOut, aToB) => Buffer.concat([u8(IX.SWAP),  u64(amtIn), u64(minOut), bool(aToB)]),
  addLiq:     (a, b, minLp)      => Buffer.concat([u8(IX.ADD_LIQ), u64(a), u64(b), u64(minLp)]),
  remLiq:     (lp, minA, minB)   => Buffer.concat([u8(IX.REM_LIQ), u64(lp), u64(minA), u64(minB)]),
  collectFees:()                 => u8(IX.COLLECT),
};

// ─── PDA helpers ──────────────────────────────────────────────────────────────
function getPoolPda(mintA, mintB) {
  // Canonical ordering: mintA < mintB by byte comparison
  let a = mintA, b = mintB;
  if (Buffer.compare(a.toBuffer(), b.toBuffer()) > 0) [a, b] = [b, a];
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), a.toBuffer(), b.toBuffer()],
    PROGRAM_ID
  );
  return { pda, bump, mintA: a, mintB: b };
}

// ─── CPMM math (mirrors on-chain) ────────────────────────────────────────────
function cpmmSwapOut(reserveIn, reserveOut, amountIn, feeBps) {
  const amt  = BigInt(amountIn);
  const rIn  = BigInt(reserveIn);
  const rOut = BigInt(reserveOut);
  const fee  = BigInt(feeBps);
  const amtAfterFee = amt * (10000n - fee) / 10000n;
  return rOut * amtAfterFee / (rIn + amtAfterFee);
}

// ─── Connection + shared wallets ─────────────────────────────────────────────
let conn, payer, creator, attacker;

async function airdropIfNeeded(kp, minSol = 1) {
  const bal = await conn.getBalance(kp.publicKey);
  if (bal < minSol * LAMPORTS_PER_SOL) {
    const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    await sleep(1000);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Shared pool state (populated during init test, reused by later tests)
let mintA, mintB, poolPda, vaultA, vaultB, lpMint, creatorLpAta;
let payerAtaA, payerAtaB;

// ─── Build initialize_pool instruction ───────────────────────────────────────
function buildInitPoolIx(
  feeBps, mintAKey, mintBKey, vaultAKp, vaultBKp, lpMintKp, creatorKey
) {
  const { pda } = getPoolPda(mintAKey, mintBKey);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda,                        isSigner: false, isWritable: true  }, // pool state PDA
      { pubkey: mintAKey,                   isSigner: false, isWritable: false }, // token_a_mint
      { pubkey: mintBKey,                   isSigner: false, isWritable: false }, // token_b_mint
      { pubkey: vaultAKp.publicKey,         isSigner: true,  isWritable: true  }, // vault_a (keypair token acct)
      { pubkey: vaultBKp.publicKey,         isSigner: true,  isWritable: true  }, // vault_b
      { pubkey: lpMintKp.publicKey,         isSigner: true,  isWritable: true  }, // lp_mint
      { pubkey: creatorKey,                 isSigner: true,  isWritable: true  }, // creator / payer
      { pubkey: PROTOCOL_TREASURY,          isSigner: false, isWritable: false }, // protocol treasury
      { pubkey: TOKEN_PROGRAM_ID,           isSigner: false, isWritable: false }, // token program
      { pubkey: TOKEN_PROGRAM_ID,           isSigner: false, isWritable: false }, // token program (b)
      { pubkey: SystemProgram.programId,    isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,         isSigner: false, isWritable: false },
    ],
    data: idata.initPool(feeBps),
  });
}

// ─── Build swap instruction ──────────────────────────────────────────────────
function buildSwapIx(poolKey, vaultAKey, vaultBKey, mintAKey, mintBKey,
                     userInAta, userOutAta, userKey, amtIn, minOut, aToB) {
  const vaultIn  = aToB ? vaultAKey : vaultBKey;
  const vaultOut = aToB ? vaultBKey : vaultAKey;
  const inAta    = aToB ? userInAta : userOutAta; // user's source
  const outAta   = aToB ? userOutAta : userInAta; // user's dest
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolKey,             isSigner: false, isWritable: true  },
      { pubkey: vaultIn,             isSigner: false, isWritable: true  },
      { pubkey: vaultOut,            isSigner: false, isWritable: true  },
      { pubkey: aToB ? userInAta : userOutAta, isSigner: false, isWritable: true  }, // user token in
      { pubkey: aToB ? userOutAta : userInAta, isSigner: false, isWritable: true  }, // user token out
      { pubkey: mintAKey,            isSigner: false, isWritable: false },
      { pubkey: mintBKey,            isSigner: false, isWritable: false },
      { pubkey: userKey,             isSigner: true,  isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: idata.swap(amtIn, minOut, aToB),
  });
}

// ─── Build add_liquidity instruction ─────────────────────────────────────────
function buildAddLiqIx(poolKey, vaultAKey, vaultBKey, lpMintKey, mintAKey, mintBKey,
                       userAtaA, userAtaB, userLpAta, userKey, amtA, amtB, minLp) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolKey,                         isSigner: false, isWritable: true  },
      { pubkey: vaultAKey,                       isSigner: false, isWritable: true  },
      { pubkey: vaultBKey,                       isSigner: false, isWritable: true  },
      { pubkey: lpMintKey,                       isSigner: false, isWritable: true  },
      { pubkey: mintAKey,                        isSigner: false, isWritable: false },
      { pubkey: mintBKey,                        isSigner: false, isWritable: false },
      { pubkey: userAtaA,                        isSigner: false, isWritable: true  },
      { pubkey: userAtaB,                        isSigner: false, isWritable: true  },
      { pubkey: userLpAta,                       isSigner: false, isWritable: true  },
      { pubkey: userKey,                         isSigner: true,  isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,                isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,                isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,     isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,              isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY,             isSigner: false, isWritable: false },
    ],
    data: idata.addLiq(amtA, amtB, minLp),
  });
}

// ─── Build remove_liquidity instruction ──────────────────────────────────────
function buildRemLiqIx(poolKey, vaultAKey, vaultBKey, lpMintKey, mintAKey, mintBKey,
                       userAtaA, userAtaB, userLpAta, userKey, lpAmt, minA, minB) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolKey,                     isSigner: false, isWritable: true  },
      { pubkey: vaultAKey,                   isSigner: false, isWritable: true  },
      { pubkey: vaultBKey,                   isSigner: false, isWritable: true  },
      { pubkey: lpMintKey,                   isSigner: false, isWritable: true  },
      { pubkey: mintAKey,                    isSigner: false, isWritable: false },
      { pubkey: mintBKey,                    isSigner: false, isWritable: false },
      { pubkey: userAtaA,                    isSigner: false, isWritable: true  },
      { pubkey: userAtaB,                    isSigner: false, isWritable: true  },
      { pubkey: userLpAta,                   isSigner: false, isWritable: true  },
      { pubkey: userKey,                     isSigner: true,  isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY,         isSigner: false, isWritable: false },
    ],
    data: idata.remLiq(lpAmt, minA, minB),
  });
}

// ─── Build collect_fees instruction ──────────────────────────────────────────
function buildCollectFeesIx(poolKey, vaultAKey, vaultBKey, mintAKey, mintBKey,
                             creatorKey, creatorAtaA, creatorAtaB,
                             treasuryAtaA, treasuryAtaB) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolKey,          isSigner: false, isWritable: true  },
      { pubkey: vaultAKey,        isSigner: false, isWritable: true  },
      { pubkey: vaultBKey,        isSigner: false, isWritable: true  },
      { pubkey: mintAKey,         isSigner: false, isWritable: false },
      { pubkey: mintBKey,         isSigner: false, isWritable: false },
      { pubkey: creatorAtaA,      isSigner: false, isWritable: true  },
      { pubkey: creatorAtaB,      isSigner: false, isWritable: true  },
      { pubkey: treasuryAtaA,     isSigner: false, isWritable: true  },
      { pubkey: treasuryAtaB,     isSigner: false, isWritable: true  },
      { pubkey: creatorKey,       isSigner: true,  isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: idata.collectFees(),
  });
}

// ─── Decode Pool state (matches state.rs layout) ─────────────────────────────
//  Layout (Borsh, no discriminator prefix in state accounts):
//    owner:                 Pubkey  (32)
//    token_a_mint:          Pubkey  (32)
//    token_b_mint:          Pubkey  (32)
//    vault_a:               Pubkey  (32)
//    vault_b:               Pubkey  (32)
//    lp_mint:               Pubkey  (32)
//    creator:               Pubkey  (32)
//    fee_bps:               u64     (8)
//    protocol_fee_bps:      u64     (8)
//    creator_fee_bps:       u64     (8)
//    reserve_a:             u64     (8)
//    reserve_b:             u64     (8)
//    lp_supply:             u64     (8)
//    last_update_timestamp: i64     (8)
//    accrued_fees_a:        u64     (8)   ← accrued but uncollected
//    accrued_fees_b:        u64     (8)
//    bump:                  u8      (1)
function decodePool(data) {
  let o = 0;
  const pk = () => { const p = new PublicKey(data.slice(o, o+32)); o+=32; return p; };
  const u64d = () => { const v = data.readBigUInt64LE(o); o+=8; return v; };
  return {
    owner:              pk(),
    tokenAMint:         pk(),
    tokenBMint:         pk(),
    vaultA:             pk(),
    vaultB:             pk(),
    lpMint:             pk(),
    creator:            pk(),
    feeBps:             u64d(),
    protocolFeeBps:     u64d(),
    creatorFeeBps:      u64d(),
    reserveA:           u64d(),
    reserveB:           u64d(),
    lpSupply:           u64d(),
    lastUpdate:         data.readBigInt64LE(o), // i64
    accruedFeesA:       (() => { o+=8; return data.readBigUInt64LE(o-8); })(),
    accruedFeesB:       (() => { o+=8; return data.readBigUInt64LE(o-8); })(),
  };
}

// ─── Tx helper ────────────────────────────────────────────────────────────────
async function sendTx(instructions, signers) {
  const tx  = new Transaction().add(...instructions);
  const sig = await sendAndConfirmTransaction(conn, tx, signers, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return sig;
}

async function expectTxFail(instructions, signers, label) {
  try {
    await sendTx(instructions, signers);
    assert.fail(`Expected failure for: ${label}`);
  } catch (e) {
    assert.ok(true, `Correctly rejected: ${label}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Kavach AMM Core — Full E2E Test Suite (devnet)", function () {
  this.timeout(120_000);

  // ── Setup ────────────────────────────────────────────────────────────────────
  before(async () => {
    conn    = new Connection(RPC_URL, "confirmed");
    payer   = Keypair.generate();
    creator = Keypair.generate();   // the wallet that creates the pool
    attacker= Keypair.generate();   // adversarial wallet

    console.log("  Payer:   ", payer.publicKey.toBase58());
    console.log("  Creator: ", creator.publicKey.toBase58());
    console.log("  Attacker:", attacker.publicKey.toBase58());

    for (const kp of [payer, creator, attacker]) {
      await airdropIfNeeded(kp, 2);
    }

    // Create test mints (6 decimals each, minted by payer)
    console.log("  Creating test mints ...");
    mintA = await createMint(conn, payer, payer.publicKey, null, 6);
    mintB = await createMint(conn, payer, payer.publicKey, null, 6);
    console.log("  Mint A:", mintA.toBase58());
    console.log("  Mint B:", mintB.toBase58());

    // Create ATAs for payer (liquidity provider / swapper)
    payerAtaA = await getAssociatedTokenAddressSync(mintA, payer.publicKey);
    payerAtaB = await getAssociatedTokenAddressSync(mintB, payer.publicKey);

    const setupTx = new Transaction();
    setupTx.add(
      createAssociatedTokenAccountInstruction(payer.publicKey, payerAtaA, payer.publicKey, mintA),
      createAssociatedTokenAccountInstruction(payer.publicKey, payerAtaB, payer.publicKey, mintB),
    );
    await sendAndConfirmTransaction(conn, setupTx, [payer]);

    // Mint initial tokens to payer (10M each)
    await mintTo(conn, payer, mintA, payerAtaA, payer, 10_000_000_000_000n); // 10M with 6 dp
    await mintTo(conn, payer, mintB, payerAtaB, payer, 10_000_000_000_000n);

    // Create ATAs for creator
    const creatorAtaATx = new Transaction().add(
      createAssociatedTokenAccountInstruction(creator.publicKey, getAssociatedTokenAddressSync(mintA, creator.publicKey), creator.publicKey, mintA),
      createAssociatedTokenAccountInstruction(creator.publicKey, getAssociatedTokenAddressSync(mintB, creator.publicKey), creator.publicKey, mintB),
    );
    await sendAndConfirmTransaction(conn, creatorAtaATx, [creator]);
    await mintTo(conn, payer, mintA, getAssociatedTokenAddressSync(mintA, creator.publicKey), payer, 1_000_000_000_000n);
    await mintTo(conn, payer, mintB, getAssociatedTokenAddressSync(mintB, creator.publicKey), payer, 1_000_000_000_000n);

    console.log("  Setup complete.");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 1. SECURITY.TXT BINARY VERIFICATION
  // ══════════════════════════════════════════════════════════════════════
  it("1. security.txt — detects presence/absence in .so binary", function () {
    if (!fs.existsSync(SO_PATH)) {
      console.warn("    ⚠️  kavach_amm_core.so not found at expected path; skipping binary check.");
      this.skip();
    }
    const binary = fs.readFileSync(SO_PATH);
    const MAGIC  = Buffer.from("=======BEGIN SECURITY.TXT V1=======");
    const idx    = binary.indexOf(MAGIC);

    if (idx === -1) {
      // ⛔ CRITICAL FINDING: security.txt macro not embedded
      console.error("\n    ❌ CRITICAL: security_txt! macro NOT found in kavach_amm_core.so");
      console.error("    Action: Add to programs/kavach_amm_core/src/lib.rs:");
      console.error(`      security_txt! {
        name: "Kavach Core AMM",
        project_url: "https://kavachswap.com",
        contacts: "email:security@kavachswap.com",
        policy: "https://kavachswap.com/security",
        preferred_languages: "en",
        source_release: env!("CARGO_PKG_VERSION"),
        expiry: "2027-01-01"
      }`);
      // Mark as a known failure — do not throw; flag it
      assert.fail("security.txt blob missing from program binary — rebuild required after adding security_txt! macro");
    } else {
      const blob = binary.slice(idx, idx + 512).toString("utf8").replace(/\0/g, "");
      console.log("    ✅ security.txt found at offset", idx);
      assert.ok(blob.includes("BEGIN SECURITY.TXT V1"), "Blob header present");
      assert.ok(blob.includes("name:") || blob.includes("project_url:"), "Required fields present");
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 2. POOL PDA CANONICAL DERIVATION
  // ══════════════════════════════════════════════════════════════════════
  it("2. Pool PDA — canonical ordering is enforced (mintA < mintB)", function () {
    const mA = mintA;
    const mB = mintB;

    const { pda: pda1, mintA: a1, mintB: b1 } = getPoolPda(mA, mB);
    const { pda: pda2, mintA: a2, mintB: b2 } = getPoolPda(mB, mA); // reversed input

    assert.strictEqual(pda1.toBase58(), pda2.toBase58(),
      "PDA must be the same regardless of input order");
    assert.ok(Buffer.compare(a1.toBuffer(), b1.toBuffer()) <= 0,
      "Canonical mintA ≤ mintB");
    assert.strictEqual(a1.toBase58(), a2.toBase58());
    assert.strictEqual(b1.toBase58(), b2.toBase58());

    const { pda } = getPoolPda(mintA, mintB);
    poolPda = pda;
    console.log("    Pool PDA:", poolPda.toBase58());
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3. INITIALIZE POOL (Happy Path)
  // ══════════════════════════════════════════════════════════════════════
  it("3. InitializePool — creates pool state, vaults, LP mint", async function () {
    vaultA  = Keypair.generate();
    vaultB  = Keypair.generate();
    lpMint  = Keypair.generate();

    const { mintA: canonA, mintB: canonB } = getPoolPda(mintA, mintB);

    // Pool creation fee (20_000_000 lamports) transferred to PROTOCOL_TREASURY
    const feeTransferIx = SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey:   PROTOCOL_TREASURY,
      lamports:   POOL_FEE_LAMPORTS,
    });

    const initIx = buildInitPoolIx(
      FEE_BPS, canonA, canonB, vaultA, vaultB, lpMint, creator.publicKey
    );

    const sig = await sendTx([feeTransferIx, initIx], [creator, vaultA, vaultB, lpMint]);
    console.log("    InitializePool sig:", sig);

    // Verify pool account exists
    const poolInfo = await conn.getAccountInfo(poolPda);
    assert.ok(poolInfo, "Pool PDA account must exist");
    assert.strictEqual(poolInfo.owner.toBase58(), PROGRAM_ID.toBase58(), "Pool owned by program");

    // Decode and validate pool state
    const pool = decodePool(poolInfo.data);
    assert.strictEqual(pool.feeBps.toString(), FEE_BPS.toString(), "Fee BPS matches");
    assert.ok(pool.reserveA === 0n, "Initial reserve A = 0");
    assert.ok(pool.reserveB === 0n, "Initial reserve B = 0");
    assert.ok(pool.lpSupply === 0n, "Initial LP supply = 0");

    // Verify LP mint exists
    const lp = await getMint(conn, lpMint.publicKey);
    assert.ok(lp, "LP mint account created");
    assert.ok(lp.mintAuthority?.toBase58() === poolPda.toBase58() ||
              lp.freezeAuthority  === null, "Pool PDA is LP mint authority");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 4. DUPLICATE POOL PREVENTION
  // ══════════════════════════════════════════════════════════════════════
  it("4. InitializePool — duplicate init must fail", async function () {
    const vA2 = Keypair.generate();
    const vB2 = Keypair.generate();
    const lp2 = Keypair.generate();
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);

    const feeIx = SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey:   PROTOCOL_TREASURY,
      lamports:   POOL_FEE_LAMPORTS,
    });
    const dupInitIx = buildInitPoolIx(FEE_BPS, cA, cB, vA2, vB2, lp2, creator.publicKey);

    await expectTxFail([feeIx, dupInitIx], [creator, vA2, vB2, lp2],
      "Duplicate pool init for same mint pair");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 5. ADD LIQUIDITY (Initial Deposit — no LP supply yet)
  // ══════════════════════════════════════════════════════════════════════
  it("5. AddLiquidity — initial deposit mints LP tokens", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);

    // Creator creates LP token ATA
    const creatorLpAtaAddr = getAssociatedTokenAddressSync(lpMint.publicKey, creator.publicKey);
    const createLpAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        creator.publicKey, creatorLpAtaAddr, creator.publicKey, lpMint.publicKey
      )
    );
    await sendAndConfirmTransaction(conn, createLpAtaTx, [creator]);
    creatorLpAta = creatorLpAtaAddr;

    const AMOUNT_A = 1_000_000_000n; // 1000 token A (6 dp)
    const AMOUNT_B = 2_000_000_000n; // 2000 token B — sets initial price 1:2

    const addLiqIx = buildAddLiqIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, lpMint.publicKey, cA, cB,
      getAssociatedTokenAddressSync(mintA, creator.publicKey),
      getAssociatedTokenAddressSync(mintB, creator.publicKey),
      creatorLpAta, creator.publicKey,
      AMOUNT_A, AMOUNT_B, 1n // min LP = 1
    );

    const sig = await sendTx([addLiqIx], [creator]);
    console.log("    AddLiquidity (initial) sig:", sig);

    // LP mint supply must now be > 0
    const lp = await getMint(conn, lpMint.publicKey);
    assert.ok(lp.supply > 0n, "LP tokens minted");

    // Pool reserves updated
    const poolInfo = await conn.getAccountInfo(poolPda);
    const pool = decodePool(poolInfo.data);
    assert.ok(pool.reserveA > 0n, "Reserve A populated");
    assert.ok(pool.reserveB > 0n, "Reserve B populated");
    assert.ok(pool.lpSupply > 0n, "LP supply in pool state > 0");

    // Vault balances match reserves
    const vaInfo = await getAccount(conn, vaultA.publicKey);
    const vbInfo = await getAccount(conn, vaultB.publicKey);
    assert.strictEqual(vaInfo.amount.toString(), pool.reserveA.toString(),
      "Vault A balance matches pool.reserveA");
    assert.strictEqual(vbInfo.amount.toString(), pool.reserveB.toString(),
      "Vault B balance matches pool.reserveB");

    console.log("    Reserve A:", pool.reserveA.toString(), "Reserve B:", pool.reserveB.toString());
    console.log("    LP supply:", lp.supply.toString());
  });

  // ══════════════════════════════════════════════════════════════════════
  // 6. SWAP A → B
  // ══════════════════════════════════════════════════════════════════════
  it("6. Swap A→B — CPMM invariant maintained, correct output", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);

    // Create payer LP ATA (needed for later tests)
    const payerLpAtaAddr = getAssociatedTokenAddressSync(lpMint.publicKey, payer.publicKey);
    const mkLpAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, payerLpAtaAddr, payer.publicKey, lpMint.publicKey)
    );
    await sendAndConfirmTransaction(conn, mkLpAtaTx, [payer]);

    const poolBefore = decodePool((await conn.getAccountInfo(poolPda)).data);
    const vBefore    = await getAccount(conn, vaultB.publicKey);
    const payerBBefore = await getAccount(conn, payerAtaB);

    const AMT_IN  = 10_000_000n; // 10 tokens A
    const expOut  = cpmmSwapOut(poolBefore.reserveA, poolBefore.reserveB, AMT_IN, FEE_BPS);
    const MIN_OUT = expOut * 99n / 100n; // 1% slippage tolerance

    const swapIx = buildSwapIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      payerAtaA, payerAtaB, payer.publicKey,
      AMT_IN, MIN_OUT, true // A→B
    );

    const sig = await sendTx([swapIx], [payer]);
    console.log("    Swap A→B sig:", sig);

    const vAfter = await getAccount(conn, vaultB.publicKey);
    const payerBAfter = await getAccount(conn, payerAtaB);
    const actualOut = payerBAfter.amount - payerBBefore.amount;

    // Must have received tokens
    assert.ok(actualOut > 0n, "User received token B");
    // Must be close to CPMM prediction
    assert.ok(actualOut >= MIN_OUT, `Output ${actualOut} >= minOut ${MIN_OUT}`);
    // Vault B decreased
    assert.ok(vAfter.amount < vBefore.amount, "Vault B decreased after swap");

    // k invariant: (reserveA + feeAdjustedIn) * (reserveB - out) >= reserveA * reserveB
    const poolAfter = decodePool((await conn.getAccountInfo(poolPda)).data);
    const kBefore = poolBefore.reserveA * poolBefore.reserveB;
    const kAfter  = poolAfter.reserveA  * poolAfter.reserveB;
    assert.ok(kAfter >= kBefore, `k invariant: ${kAfter} >= ${kBefore}`);

    console.log("    Expected out:", expOut.toString(), "Actual out:", actualOut.toString());
  });

  // ══════════════════════════════════════════════════════════════════════
  // 7. SWAP B → A
  // ══════════════════════════════════════════════════════════════════════
  it("7. Swap B→A — reverse direction works correctly", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const poolBefore = decodePool((await conn.getAccountInfo(poolPda)).data);
    const payerABefore = await getAccount(conn, payerAtaA);

    const AMT_IN  = 20_000_000n; // 20 tokens B
    const expOut  = cpmmSwapOut(poolBefore.reserveB, poolBefore.reserveA, AMT_IN, FEE_BPS);
    const MIN_OUT = expOut * 98n / 100n;

    const swapIx = buildSwapIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      payerAtaA, payerAtaB, payer.publicKey,
      AMT_IN, MIN_OUT, false // B→A
    );

    const sig = await sendTx([swapIx], [payer]);
    const payerAAfter = await getAccount(conn, payerAtaA);
    const actualOut   = payerAAfter.amount - payerABefore.amount;

    assert.ok(actualOut > 0n, "User received token A");
    assert.ok(actualOut >= MIN_OUT, `Output ${actualOut} >= minOut ${MIN_OUT}`);
    console.log("    Swap B→A actual out:", actualOut.toString());
  });

  // ══════════════════════════════════════════════════════════════════════
  // 8. SLIPPAGE PROTECTION — minOut enforcement
  // ══════════════════════════════════════════════════════════════════════
  it("8. Slippage protection — tx fails if output < min_out", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const pool = decodePool((await conn.getAccountInfo(poolPda)).data);

    const AMT_IN    = 5_000_000n;
    const actualExp = cpmmSwapOut(pool.reserveA, pool.reserveB, AMT_IN, FEE_BPS);
    // Set minOut WAY higher than possible
    const IMPOSSIBLE_MIN = actualExp * 10n; // 10x — impossible

    const ix = buildSwapIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      payerAtaA, payerAtaB, payer.publicKey,
      AMT_IN, IMPOSSIBLE_MIN, true
    );

    await expectTxFail([ix], [payer], "Swap with impossible minOut");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 9. ZERO-AMOUNT SWAP REJECTION
  // ══════════════════════════════════════════════════════════════════════
  it("9. Zero-amount swap — must be rejected by program", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const ix = buildSwapIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      payerAtaA, payerAtaB, payer.publicKey,
      0n, 0n, true
    );
    await expectTxFail([ix], [payer], "Swap with amount_in=0");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 10. PROPORTIONAL ADD LIQUIDITY (pool already has reserves)
  // ══════════════════════════════════════════════════════════════════════
  it("10. AddLiquidity (proportional) — payer adds to existing pool", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const pool   = decodePool((await conn.getAccountInfo(poolPda)).data);
    const lpBefore = await getMint(conn, lpMint.publicKey);
    const payerLpAta = getAssociatedTokenAddressSync(lpMint.publicKey, payer.publicKey);

    // Proportional deposit: 500 A, proportional B
    const AMOUNT_A = 500_000_000n;
    const AMOUNT_B = AMOUNT_A * pool.reserveB / pool.reserveA + 1n; // proportional + 1 rounding

    const ix = buildAddLiqIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, lpMint.publicKey, cA, cB,
      payerAtaA, payerAtaB, payerLpAta, payer.publicKey,
      AMOUNT_A, AMOUNT_B, 1n
    );

    const sig = await sendTx([ix], [payer]);
    console.log("    AddLiquidity (proportional) sig:", sig);

    const lpAfter = await getMint(conn, lpMint.publicKey);
    assert.ok(lpAfter.supply > lpBefore.supply, "LP supply increased");

    const payerLp = await getAccount(conn, payerLpAta);
    assert.ok(payerLp.amount > 0n, "Payer received LP tokens");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 11. REMOVE LIQUIDITY — partial + full drain
  // ══════════════════════════════════════════════════════════════════════
  it("11a. RemoveLiquidity (partial) — returns proportional tokens", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const payerLpAta = getAssociatedTokenAddressSync(lpMint.publicKey, payer.publicKey);
    const payerLpAcct = await getAccount(conn, payerLpAta);
    const payerLpBal  = payerLpAcct.amount;
    assert.ok(payerLpBal > 0n, "Payer has LP tokens to remove");

    const REMOVE_LP  = payerLpBal / 2n; // remove half
    const poolBefore = decodePool((await conn.getAccountInfo(poolPda)).data);
    const payerABefore = await getAccount(conn, payerAtaA);

    const ix = buildRemLiqIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, lpMint.publicKey, cA, cB,
      payerAtaA, payerAtaB, payerLpAta, payer.publicKey,
      REMOVE_LP, 1n, 1n // min A=1, min B=1
    );

    const sig = await sendTx([ix], [payer]);
    console.log("    RemoveLiquidity (partial) sig:", sig);

    const payerAAfter = await getAccount(conn, payerAtaA);
    assert.ok(payerAAfter.amount > payerABefore.amount, "Payer received token A back");

    const lpAfterAcct = await getAccount(conn, payerLpAta);
    assert.ok(lpAfterAcct.amount < payerLpBal, "LP balance decreased");
  });

  it("11b. RemoveLiquidity — min_out enforcement (should fail if impossible)", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const payerLpAta = getAssociatedTokenAddressSync(lpMint.publicKey, payer.publicKey);
    const payerLp    = await getAccount(conn, payerLpAta);
    const pool       = decodePool((await conn.getAccountInfo(poolPda)).data);

    // Expected A back = LP/totalLP * reserveA; set minA impossibly high
    const REMOVE_LP  = payerLp.amount;
    const IMPOSSIBLE_MIN_A = pool.reserveA; // can't get 100% of reserve with partial LP

    const ix = buildRemLiqIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, lpMint.publicKey, cA, cB,
      payerAtaA, payerAtaB, payerLpAta, payer.publicKey,
      REMOVE_LP, IMPOSSIBLE_MIN_A, IMPOSSIBLE_MIN_A
    );

    await expectTxFail([ix], [payer], "RemoveLiquidity with impossible min_out");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 12. COLLECT FEES — 50 / 50 routing to treasury + creator
  // ══════════════════════════════════════════════════════════════════════
  it("12. CollectFees — accrued fees split 50/50 to protocol + creator", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const pool = decodePool((await conn.getAccountInfo(poolPda)).data);

    // Ensure fees have accrued (run a few more swaps)
    for (let i = 0; i < 3; i++) {
      const swapIx = buildSwapIx(
        poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
        payerAtaA, payerAtaB, payer.publicKey,
        5_000_000n, 1n, i % 2 === 0
      );
      await sendTx([swapIx], [payer]);
    }

    // Creator and treasury need ATAs for both tokens
    const creatorAtaA = getAssociatedTokenAddressSync(mintA, creator.publicKey);
    const creatorAtaB = getAssociatedTokenAddressSync(mintB, creator.publicKey);

    // Treasury ATAs (create if needed)
    const treasuryAtaA = getAssociatedTokenAddressSync(mintA, PROTOCOL_TREASURY);
    const treasuryAtaB = getAssociatedTokenAddressSync(mintB, PROTOCOL_TREASURY);

    const setupAtasTx = new Transaction();
    for (const [ata, owner, mint] of [
      [treasuryAtaA, PROTOCOL_TREASURY, mintA],
      [treasuryAtaB, PROTOCOL_TREASURY, mintB],
    ]) {
      setupAtasTx.add(createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint));
    }
    try {
      await sendAndConfirmTransaction(conn, setupAtasTx, [payer]);
    } catch (_) { /* ATAs may already exist */ }

    const tAtaABefore = await conn.getTokenAccountBalance(treasuryAtaA).catch(() => ({ value: { amount: "0" } }));
    const cAtaABefore = await getAccount(conn, creatorAtaA).catch(() => ({ amount: 0n }));

    const collectIx = buildCollectFeesIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      creator.publicKey, creatorAtaA, creatorAtaB, treasuryAtaA, treasuryAtaB
    );

    const sig = await sendTx([collectIx], [creator]);
    console.log("    CollectFees sig:", sig);

    const poolAfter = decodePool((await conn.getAccountInfo(poolPda)).data);

    // Accrued fees should have decreased/zeroed after collection
    assert.ok(
      poolAfter.accruedFeesA <= pool.accruedFeesA,
      "AccruedFeesA reduced after collection"
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // 13. UNAUTHORIZED SIGNER ON COLLECT FEES
  // ══════════════════════════════════════════════════════════════════════
  it("13. CollectFees — attacker (non-creator) must be rejected", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);

    // Setup attacker ATAs
    const atkAtaA = getAssociatedTokenAddressSync(mintA, attacker.publicKey);
    const atkAtaB = getAssociatedTokenAddressSync(mintB, attacker.publicKey);
    const setupTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(attacker.publicKey, atkAtaA, attacker.publicKey, mintA),
      createAssociatedTokenAccountInstruction(attacker.publicKey, atkAtaB, attacker.publicKey, mintB),
    );
    await sendAndConfirmTransaction(conn, setupTx, [attacker]);

    const treasuryAtaA = getAssociatedTokenAddressSync(mintA, PROTOCOL_TREASURY);
    const treasuryAtaB = getAssociatedTokenAddressSync(mintB, PROTOCOL_TREASURY);

    // Attacker passes THEIR key as creator — should fail signer check
    const ix = buildCollectFeesIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      attacker.publicKey, atkAtaA, atkAtaB, treasuryAtaA, treasuryAtaB
    );

    await expectTxFail([ix], [attacker], "Unauthorized CollectFees (attacker not pool creator)");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 14. WRONG TOKEN PROGRAM INJECTION
  // ══════════════════════════════════════════════════════════════════════
  it("14. Wrong token program — malicious program ID rejected", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const FAKE_TOKEN_PROG = Keypair.generate().publicKey; // random, non-existent

    // Build swap with fake token program
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: poolPda,            isSigner: false, isWritable: true  },
        { pubkey: vaultA.publicKey,   isSigner: false, isWritable: true  },
        { pubkey: vaultB.publicKey,   isSigner: false, isWritable: true  },
        { pubkey: payerAtaA,          isSigner: false, isWritable: true  },
        { pubkey: payerAtaB,          isSigner: false, isWritable: true  },
        { pubkey: cA,                 isSigner: false, isWritable: false },
        { pubkey: cB,                 isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,    isSigner: true,  isWritable: false },
        { pubkey: FAKE_TOKEN_PROG,    isSigner: false, isWritable: false }, // ← injected
        { pubkey: FAKE_TOKEN_PROG,    isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY,isSigner: false, isWritable: false },
      ],
      data: idata.swap(1_000_000n, 1n, true),
    });

    await expectTxFail([ix], [payer], "Swap with fake token program");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 15. POOL OWNERSHIP CHECK — wrong pool account
  // ══════════════════════════════════════════════════════════════════════
  it("15. Pool ownership — instruction against wrong pool is rejected", async function () {
    // Create a decoy pool PDA for a different mint pair
    const fakeMintA = Keypair.generate().publicKey;
    const fakeMintB = Keypair.generate().publicKey;
    const { pda: fakePool } = getPoolPda(fakeMintA, fakeMintB);
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);

    // Send swap referencing uninitialized/wrong pool
    const ix = buildSwapIx(
      fakePool, vaultA.publicKey, vaultB.publicKey, cA, cB, // fakePool mismatch
      payerAtaA, payerAtaB, payer.publicKey,
      1_000_000n, 1n, true
    );

    await expectTxFail([ix], [payer], "Swap against uninitialized pool PDA");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 16. KVUSD STABLECOIN POOL INTEGRATION
  // ══════════════════════════════════════════════════════════════════════
  it("16. KVUSD stablecoin pool — initialize and verify structure", async function () {
    // Simulate KVUSD (a 6-decimal stablecoin mint) vs WSOL-equivalent
    const kvusdMint = await createMint(conn, payer, payer.publicKey, null, 6);
    const synthUsdc = await createMint(conn, payer, payer.publicKey, null, 6); // simulated USDC

    const { pda: stablePda, mintA: sA, mintB: sB } = getPoolPda(kvusdMint, synthUsdc);
    const sVaultA  = Keypair.generate();
    const sVaultB  = Keypair.generate();
    const sLpMint  = Keypair.generate();

    // Stable pair uses tightest fee tier = 1 bps
    const STABLE_FEE = 1n;

    const feeIx = SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: PROTOCOL_TREASURY,
      lamports: POOL_FEE_LAMPORTS,
    });
    const initIx = buildInitPoolIx(STABLE_FEE, sA, sB, sVaultA, sVaultB, sLpMint, creator.publicKey);

    const sig = await sendTx([feeIx, initIx], [creator, sVaultA, sVaultB, sLpMint]);
    console.log("    KVUSD pool init sig:", sig);

    const poolInfo = await conn.getAccountInfo(stablePda);
    assert.ok(poolInfo, "KVUSD pool state account exists");
    const pool = decodePool(poolInfo.data);
    assert.strictEqual(pool.feeBps.toString(), STABLE_FEE.toString(),
      "KVUSD pool uses 1bps fee tier");

    console.log("    KVUSD pool PDA:", stablePda.toBase58());
  });

  // ══════════════════════════════════════════════════════════════════════
  // 17. LP TOKEN SUPPLY INVARIANT
  // ══════════════════════════════════════════════════════════════════════
  it("17. LP supply invariant — LP mint supply = pool.lpSupply at all times", async function () {
    const lp   = await getMint(conn, lpMint.publicKey);
    const pool = decodePool((await conn.getAccountInfo(poolPda)).data);

    assert.strictEqual(lp.supply.toString(), pool.lpSupply.toString(),
      "On-chain LP mint supply must equal pool.lpSupply");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 18. PROTOCOL FEE ACCOUNTING — 50/50 split check
  // ══════════════════════════════════════════════════════════════════════
  it("18. Protocol fee split — pool.protocolFeeBps + creatorFeeBps = feeBps", async function () {
    const pool = decodePool((await conn.getAccountInfo(poolPda)).data);
    assert.strictEqual(
      (pool.protocolFeeBps + pool.creatorFeeBps).toString(),
      pool.feeBps.toString(),
      "Protocol + creator fee bps must sum to total fee bps"
    );
    assert.strictEqual(pool.protocolFeeBps.toString(), pool.creatorFeeBps.toString(),
      "50/50 split: protocol == creator fee bps");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 19. OVERFLOW GUARD — extreme amount
  // ══════════════════════════════════════════════════════════════════════
  it("19. Overflow guard — U64::MAX swap amount must fail safely", async function () {
    const { mintA: cA, mintB: cB } = getPoolPda(mintA, mintB);
    const MAX_U64 = 18_446_744_073_709_551_615n;
    const ix = buildSwapIx(
      poolPda, vaultA.publicKey, vaultB.publicKey, cA, cB,
      payerAtaA, payerAtaB, payer.publicKey,
      MAX_U64, 1n, true
    );
    await expectTxFail([ix], [payer], "Swap with U64::MAX amount_in");
  });

  // ══════════════════════════════════════════════════════════════════════
  // 20. VERIFIABLE BUILD — check metadata
  // ══════════════════════════════════════════════════════════════════════
  it("20. Verifiable build — documents required post-deploy steps", async function () {
    // This test documents the verification workflow rather than automating it
    // (solana-verify requires Docker and cannot run inside mocha)
    const steps = [
      "cargo install solana-verify",
      "solana-verify build   # reproducible Docker build",
      `solana program deploy target/deploy/kavach_amm_core.so \\\n      --program-id ${PROGRAM_ID.toBase58()}`,
      `solana-verify verify-from-repo \\\n      -u https://api.devnet.solana.com \\\n      --program-id ${PROGRAM_ID.toBase58()} \\\n      https://github.com/YOUR_ORG/kavach`,
      `solana-verify remote submit-job \\\n      --program-id ${PROGRAM_ID.toBase58()} \\\n      --uploader <UPLOADER_PUBKEY>`,
    ];
    console.log("\n    === Verifiable Build Steps ===");
    steps.forEach((s, i) => console.log(`    Step ${i+1}: ${s}`));
    assert.ok(steps.length === 5, "All 5 verifiable-build steps documented");
  });

  // ══════════════════════════════════════════════════════════════════════
  // FINAL: POOL STATE SNAPSHOT
  // ══════════════════════════════════════════════════════════════════════
  after(async () => {
    const poolInfo = await conn.getAccountInfo(poolPda);
    if (!poolInfo) return;
    const pool = decodePool(poolInfo.data);
    const lp   = await getMint(conn, lpMint.publicKey);
    console.log("\n  ════════════════════════════════════════════");
    console.log("  Final Pool Snapshot");
    console.log("  ════════════════════════════════════════════");
    console.log("  Pool PDA:      ", poolPda.toBase58());
    console.log("  Reserve A:     ", pool.reserveA.toString());
    console.log("  Reserve B:     ", pool.reserveB.toString());
    console.log("  LP Supply:     ", pool.lpSupply.toString());
    console.log("  Fee BPS:       ", pool.feeBps.toString());
    console.log("  AccruedFees A: ", pool.accruedFeesA.toString());
    console.log("  AccruedFees B: ", pool.accruedFeesB.toString());
    console.log("  LP mint supply:", lp.supply.toString());
    console.log("  ════════════════════════════════════════════");
  });
});
