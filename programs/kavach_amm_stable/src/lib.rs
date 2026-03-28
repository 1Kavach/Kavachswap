//! Kavach Stable AMM — StableSwap-style curve, 18-decimal normalized math, Token-2022 + `transfer_checked`.
//! Swap fee on **output**; protocol + creator paid in the same instruction (output-mint ATAs).

#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
use {default_env::default_env, solana_security_txt::security_txt};

pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod processor;
pub mod state;
pub mod token_io;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Kavach Stable AMM",
    project_url: "https://kavachswap.com",
    source_code: "https://github.com/1Kavach/Kavachswap",
    contacts: "link:https://kavachswap.com/security,email:security@kavachswap.com",
    policy: "https://kavachswap.com/security",
    preferred_languages: "en",
    source_revision: default_env!("GITHUB_SHA", ""),
    source_release: default_env!("GITHUB_REF_NAME", ""),
    auditors: "None",
    expiry: "2028-12-31"
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
