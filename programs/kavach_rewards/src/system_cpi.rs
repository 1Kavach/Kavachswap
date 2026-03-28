//! System program `CreateAccount` CPI — bincode must match `solana_program::system_instruction`.

use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    instruction::{AccountMeta, Instruction, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

/// Serializes like `solana_program::system_instruction::SystemInstruction::CreateAccount`.
#[derive(serde::Serialize)]
enum KrSystemInstruction {
    CreateAccount {
        lamports: u64,
        space: u64,
        owner: [u8; 32],
    },
}

pub fn create_account<'a>(
    payer: &'a AccountInfo,
    new_account: &'a AccountInfo,
    system_program: &'a AccountInfo,
    owner_program: &Pubkey,
    space: u64,
    lamports: u64,
    signers: &[Signer],
) -> ProgramResult {
    let ix_data = KrSystemInstruction::CreateAccount {
        lamports,
        space,
        owner: *owner_program,
    };
    let data = bincode::serialize(&ix_data).map_err(|_| ProgramError::InvalidInstructionData)?;

    let instruction = Instruction {
        program_id: system_program.key(),
        accounts: &[
            AccountMeta::writable_signer(payer.key()),
            AccountMeta::writable_signer(new_account.key()),
        ],
        data: data.as_slice(),
    };

    invoke_signed(&instruction, &[payer, new_account], signers)
}
