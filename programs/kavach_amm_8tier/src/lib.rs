//! Kavach 8-tier AMM — exact copy of kavach_amm with 8 fee choices at pool init.
//! Creator picks one of: 0.25%, 0.5%, 0.8%, 1%, 1.25%, 1.5%, 2%, 2.5%. 50/50 protocol/creator.

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
