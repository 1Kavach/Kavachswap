//! CLMM pool state + bins. Pool PDA seeds: [b"pool", token_a_mint, token_b_mint].
//! Bins are stored in the same account after pool state (Meteora DLMM / Raydium-style: bin step, active bin).
//! 50/50 protocol/creator from swap fee; no pool-creation fee (user pays rent only).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Number of bins (centered around active). 256 bins = 128 each side.
pub const NUM_BINS: usize = 256;
/// Bin struct size: reserve_a + reserve_b + liquidity_shares
pub const BIN_LEN: usize = 8 + 8 + 16; // 32 bytes
/// Bins region size in pool account
pub const BINS_REGION_LEN: usize = NUM_BINS * BIN_LEN;

/// Pool state (no bins in struct; bins follow in same account).
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Pool {
    pub is_initialized: bool,
    pub bump: u8,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    /// Current price bin index (0..NUM_BINS). Center = NUM_BINS/2.
    pub active_bin_id: u16,
    /// Bin step in basis points (e.g. 10 = 0.1% between bins). Meteora-style.
    pub bin_step: u16,
    /// Swap fee in bps (e.g. 30 = 0.3%)
    pub base_fee_bps: u64,
    /// Protocol share of fee (5000 = 50%)
    pub protocol_fee_bps: u64,
    /// Creator share of fee (5000 = 50%)
    pub creator_fee_bps: u64,
    pub protocol_fee_recipient: Pubkey,
    pub creator_fee_recipient: Pubkey,
    pub total_fees_a: u64,
    pub total_fees_b: u64,
    pub cumulative_volume_a: u128,
    pub cumulative_volume_b: u128,
    pub last_update_timestamp: i64,
}

/// 1+1+32*4+2+2+8+8+8+32*2+8*2+16*2+8 = 2+128+4+24+64+16+32+8 = 278; round to 280 for alignment
impl Pool {
    pub const LEN: usize = 2 + (32 * 4) + 2 + 2 + 8 + 8 + 8 + (32 * 2) + 8 + 8 + 16 + 16 + 8;

    /// Total pool account size: state + bins
    pub const ACCOUNT_LEN: usize = Self::LEN + BINS_REGION_LEN;

    pub fn pool_signer_seeds(&self) -> [&[u8]; 4] {
        [
            b"pool",
            self.token_a_mint.as_ref(),
            self.token_b_mint.as_ref(),
            std::slice::from_ref(&self.bump),
        ]
    }
}

/// Single bin: reserves and liquidity shares. Stored raw (no Borsh) in bins region.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Bin {
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub liquidity_shares: u128,
}

/// LP position in a single bin. PDA seeds: [b"position", pool.key(), user.key(), bin_index (u16 le)].
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Position {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub bin_index: u16,
    pub liquidity_shares: u128,
}

impl Position {
    pub const LEN: usize = 32 + 32 + 2 + 16;
}

impl Bin {
    pub const LEN: usize = BIN_LEN;

    pub fn read_from_slice(data: &[u8], index: usize) -> Option<Self> {
        let start = index * Self::LEN;
        let end = start + Self::LEN;
        if end > data.len() {
            return None;
        }
        let chunk = &data[start..end];
        let reserve_a = u64::from_le_bytes(chunk[0..8].try_into().ok()?);
        let reserve_b = u64::from_le_bytes(chunk[8..16].try_into().ok()?);
        let liquidity_shares = u128::from_le_bytes(chunk[16..32].try_into().ok()?);
        Some(Self { reserve_a, reserve_b, liquidity_shares })
    }

    pub fn write_to_slice(&self, data: &mut [u8], index: usize) {
        let start = index * Self::LEN;
        data[start..start + 8].copy_from_slice(&self.reserve_a.to_le_bytes());
        data[start + 8..start + 16].copy_from_slice(&self.reserve_b.to_le_bytes());
        data[start + 16..start + 32].copy_from_slice(&self.liquidity_shares.to_le_bytes());
    }
}
