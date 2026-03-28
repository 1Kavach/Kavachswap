//! Kavach AMM — raw Rust, no Anchor.
//! Fee: 0.3% swap; 50% protocol, 50% creator.
//! Handles makers (LPs) via add_liquidity / remove_liquidity; events for top LPs.

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
