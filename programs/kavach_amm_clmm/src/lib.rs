//! Kavach CLMM — bin-based concentrated liquidity, raw Rust, no Anchor.
//! 50/50 protocol/creator from swap fee; no pool-creation fee (user pays rent only).
//! Router-compatible: swap uses 8 accounts (pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, clock).

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod processor;
pub mod state;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
