//! Pool and account state. Pool PDA = authority for vaults and LP mint.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Pool state. PDA seeds: [b"pool", token_a_mint, token_b_mint].
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Pool {
    pub is_initialized: bool,
    pub bump: u8,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub lp_mint: Pubkey,
    /// 30 = 0.3%
    pub fee_numerator: u64,
    pub fee_denominator: u64,
    pub protocol_fee_recipient: Pubkey,
    pub creator_fee_recipient: Pubkey,
    pub protocol_fee_bps: u64,  // 5000 = 50%
    pub creator_fee_bps: u64,   // 5000 = 50%
    pub total_fees_a: u64,
    pub total_fees_b: u64,
    pub cumulative_volume_a: u128,
    pub cumulative_volume_b: u128,
    pub last_update_timestamp: i64,
}

impl Pool {
    /// 1 + 1 + 32*6 + 8*4 + 32*2 + 8*2 + 16*2 + 8 = 331
    pub const LEN: usize = 1 + 1 + (32 * 6) + (8 * 4) + (32 * 2) + (8 * 2) + (16 * 2) + 8;

    pub fn pool_signer_seeds(&self) -> [&[u8]; 4] {
        [
            b"pool",
            self.token_a_mint.as_ref(),
            self.token_b_mint.as_ref(),
            std::slice::from_ref(&self.bump),
        ]
    }
}
