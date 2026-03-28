//! Pool state: PDA [b"pool", token_a_mint, token_b_mint], canonical mint order token_a < token_b.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Pool {
    pub is_initialized: bool,
    pub bump: u8,
    /// Can call `UpdateAmpFactor`.
    pub admin: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub lp_mint: Pubkey,
    pub lp_token_program: Pubkey,
    pub amp_factor: u64,
    /// Swap fee on output, basis points / 10_000 (e.g. 4 = 0.04%).
    pub swap_fee_bps: u64,
    pub protocol_fee_bps: u64,
    pub creator_fee_bps: u64,
    pub protocol_fee_recipient: Pubkey,
    pub creator_fee_recipient: Pubkey,
    pub token_a_decimals: u8,
    pub token_b_decimals: u8,
    pub total_fees_collected_out: u128,
    pub cumulative_volume_a: u128,
    pub cumulative_volume_b: u128,
    pub last_update_timestamp: i64,
    pub padding: [u8; 48],
}

pub const MAX_SWAP_FEE_BPS: u64 = 1000;
pub const BPS_DENOMINATOR: u64 = 10_000;

impl Pool {
    pub const LEN: usize = 512;

    pub fn pool_signer_seeds(&self) -> [&[u8]; 4] {
        [
            b"pool",
            self.token_a_mint.as_ref(),
            self.token_b_mint.as_ref(),
            std::slice::from_ref(&self.bump),
        ]
    }
}
