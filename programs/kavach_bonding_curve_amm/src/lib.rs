//! Kavach Bonding Curve AMM — native Solana (no Anchor).
//! Pump-style virtual CPMM, graduation at 69 SOL, anti-snipe, 50/50 fee split, Token-2022.

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

pub mod error;
pub mod events;
pub mod instruction;
pub mod math;
pub mod state;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    instruction::process(program_id, accounts, instruction_data)
}
