#!/usr/bin/env bash
# ============================================================
#  Kavach AMM Core — Security & Verifiable Build Script
#  Typical: run from programs/kavach_amm_core/ (SO_PATH below),
#  or set SO_PATH to e2e/../programs/kavach_amm_core/target/deploy/kavach_amm_core.so
# ============================================================
set -euo pipefail

PROGRAM_ID="9SYzdw4Wd3cxDyUotZ6nhrtZt4qDHVtKQnQsiJVUsHiM"
SO_PATH="target/deploy/kavach_amm_core.so"
NETWORK="${NETWORK:-devnet}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
REPO_URL="${REPO_URL:-https://github.com/YOUR_ORG/kavach}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()  { echo -e "${GREEN}✅ $*${NC}"; }
err() { echo -e "${RED}❌ $*${NC}"; }
warn(){ echo -e "${YELLOW}⚠️  $*${NC}"; }

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Kavach AMM Core — Security & Verifiable Build Check"
echo "  Program ID: $PROGRAM_ID"
echo "  Network:    $NETWORK ($RPC_URL)"
echo "════════════════════════════════════════════════════════"
echo ""

# ─── 1. Check security.txt blob in binary ────────────────────────────
echo "── Step 1: security.txt binary check ──────────────────"
if [ ! -f "$SO_PATH" ]; then
  warn ".so not found at $SO_PATH — run 'cargo build-sbf' first"
else
  if grep -q "BEGIN SECURITY.TXT V1" "$SO_PATH" 2>/dev/null; then
    ok "security.txt blob present in $SO_PATH"
    # Show fields
    if command -v query-security-txt &>/dev/null; then
      echo ""
      echo "  Fields (query-security-txt):"
      query-security-txt "$SO_PATH" | sed 's/^/    /'
    else
      warn "query-security-txt not installed — run: cargo install query-security-txt"
      warn "Then: query-security-txt $SO_PATH"
    fi
  else
    err "security_txt! macro NOT found in $SO_PATH"
    echo ""
    echo "  To fix — add to programs/kavach_amm_core/src/lib.rs:"
    echo ""
    cat << 'MACRO'
  use solana_security_txt::security_txt;

  #[cfg(not(feature = "no-entrypoint"))]
  security_txt! {
      name:                "Kavach Core AMM",
      project_url:         "https://kavachswap.com",
      contacts:            "email:security@kavachswap.com,link:https://kavachswap.com/security",
      policy:              "https://kavachswap.com/security",
      preferred_languages: "en",
      source_code:         "https://github.com/YOUR_ORG/kavach",
      source_release:      env!("CARGO_PKG_VERSION"),
      auditors:            "None (pre-audit)",
      expiry:              "2027-01-01"
  }
MACRO
    echo ""
    echo "  Then add to Cargo.toml [dependencies]:"
    echo '    solana-security-txt = "1.1.2"'
    echo ""
    echo "  Rebuild: cargo build-sbf"
    echo ""
  fi
fi
echo ""

# ─── 2. Check on-chain security.txt (after deploy) ───────────────────
echo "── Step 2: On-chain security.txt check (Explorer) ─────"
echo "  After deploy, verify at:"
echo "  https://explorer.solana.com/address/$PROGRAM_ID/security?cluster=$NETWORK"
echo ""

# ─── 3. Install solana-verify ────────────────────────────────────────
echo "── Step 3: Install solana-verify ──────────────────────"
if command -v solana-verify &>/dev/null; then
  ok "solana-verify already installed: $(solana-verify --version 2>&1 | head -1)"
else
  warn "solana-verify not installed"
  echo "  Run: cargo install solana-verify"
  echo "  Requires Docker for reproducible build step."
fi
echo ""

# ─── 4. Reproducible build (requires Docker) ─────────────────────────
echo "── Step 4: Reproducible build ─────────────────────────"
if command -v solana-verify &>/dev/null && command -v docker &>/dev/null; then
  echo "  Running: solana-verify build"
  echo "  (This may take several minutes on first run — downloads build image)"
  solana-verify build && ok "Reproducible build succeeded" || err "Build failed"
else
  warn "solana-verify or Docker not available — skipping reproducible build"
  echo "  Steps when available:"
  echo "    1. Install Docker"
  echo "    2. cargo install solana-verify"
  echo "    3. solana-verify build"
fi
echo ""

# ─── 5. Deploy ───────────────────────────────────────────────────────
echo "── Step 5: Deploy to $NETWORK ──────────────────────────"
if [ -f "$SO_PATH" ]; then
  KEYPAIR_PATH="target/deploy/kavach_amm_core-keypair.json"
  if [ ! -f "$KEYPAIR_PATH" ]; then
    warn "Keypair not found at $KEYPAIR_PATH"
  else
    echo "  Run to deploy:"
    echo "    solana program deploy $SO_PATH \\"
    echo "      --program-id $KEYPAIR_PATH \\"
    echo "      --url $RPC_URL"
    echo ""
    echo "  (Current deploy command — execute manually to confirm)"
  fi
else
  warn "No .so to deploy. Build first."
fi
echo ""

# ─── 6. Verify from repo ─────────────────────────────────────────────
echo "── Step 6: verify-from-repo ────────────────────────────"
if command -v solana-verify &>/dev/null; then
  echo "  Run after deploy:"
  echo ""
  echo "    solana-verify verify-from-repo \\"
  echo "      -u $RPC_URL \\"
  echo "      --program-id $PROGRAM_ID \\"
  echo "      $REPO_URL"
  echo ""
  echo "  This uploads build metadata on-chain so anyone can verify."
else
  warn "solana-verify not installed — install it first (Step 3)"
fi
echo ""

# ─── 7. Submit remote verification job ───────────────────────────────
echo "── Step 7: Remote verification job ────────────────────"
echo "  After verify-from-repo succeeds, submit the job:"
echo ""
UPLOADER="${UPLOADER:-$(solana address 2>/dev/null || echo '<YOUR_PUBKEY>')}"
echo "    solana-verify remote submit-job \\"
echo "      --program-id $PROGRAM_ID \\"
echo "      --uploader $UPLOADER"
echo ""
echo "  Explorer badge will appear at:"
echo "  https://explorer.solana.com/address/$PROGRAM_ID?cluster=$NETWORK"
echo ""

# ─── Summary ─────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════"
echo "  Summary"
echo "════════════════════════════════════════════════════════"
echo ""
if [ -f "$SO_PATH" ] && grep -q "BEGIN SECURITY.TXT V1" "$SO_PATH" 2>/dev/null; then
  ok "security.txt: PRESENT in binary"
else
  err "security.txt: MISSING — add security_txt! macro and rebuild"
fi

if command -v solana-verify &>/dev/null; then
  ok "solana-verify: installed"
else
  warn "solana-verify: NOT installed (cargo install solana-verify)"
fi

echo ""
echo "  Next actions:"
echo "  1. Add security_txt! macro if missing (see Step 1)"
echo "  2. cargo build-sbf"
echo "  3. solana-verify build      (reproducible)"
echo "  4. solana program deploy    (to devnet/mainnet)"
echo "  5. solana-verify verify-from-repo + remote submit-job"
echo ""
