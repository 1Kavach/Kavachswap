//! Bonding curve config and pool state. PDAs: config = [b"bc_config"], pool = [b"pool", mint], token_vault = [b"token_vault", mint], sol_vault = [b"sol_vault", mint].

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Global config. PDA seeds = [b"bc_config"].
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct BondingCurveConfig {
    pub admin: Pubkey,
    pub protocol_treasury: Pubkey,
    pub clmm_program: Pubkey,
    pub protocol_fee_bps: u64,
    pub creator_fee_bps: u64,
    pub paused: bool,
    pub bump: u8,
}

impl BondingCurveConfig {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

/// Pool state. PDA seeds = [b"pool", mint].
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct BondingCurvePool {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub token_vault: Pubkey,
    pub sol_vault: Pubkey,
    pub virtual_sol_reserves: u64,
    pub real_sol_reserves: u64,
    pub token_reserves: u64,
    pub graduation_threshold: u64,
    pub graduated: bool,
    pub graduation_slot: u64,
    pub creator_fee_bps_override: u64,
    pub is_token_2022: bool,
    pub created_slot: u64,
    pub total_buys: u64,
    pub total_sells: u64,
    pub total_volume_sol: u64,
    pub bump: u8,
    pub sol_vault_bump: u8,
}

impl BondingCurvePool {
    pub const LEN: usize = 32 * 5 + 8 * 10 + 1 * 2 + 1 * 2; // 160 + 80 + 2 (bools) + 2 (u8 bumps) = 244

    pub fn pool_signer_seeds(&self) -> [&[u8]; 3] {
        [
            b"pool",
            self.mint.as_ref(),
            std::slice::from_ref(&self.bump),
        ]
    }
}
