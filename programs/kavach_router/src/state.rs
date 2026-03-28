//! Router config: list of 4 allowed AMM program IDs. No custody.
//! 4 AMMs (per soldexplex table): Bonding Curve (0), Stable (1), CLMM (2), Core (3).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Router config PDA: seeds = [b"config"].
/// Holds the 4 AMM program IDs and the multisig authority for UpdateConfig.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RouterConfig {
    pub is_initialized: bool,
    /// Multisig (or admin) that can call UpdateConfig. Set at InitConfig.
    pub authority: Pubkey,
    /// AMM program IDs: [0]=Bonding Curve, [1]=Stable, [2]=CLMM, [3]=Core.
    pub amm_program_ids: [Pubkey; 4],
}

impl RouterConfig {
    pub const LEN: usize = 1 + 32 + 32 * 4;
}
