//! Instruction dispatcher: 0 Init, 1 Swap, 2 AddLiq, 3 RemoveLiq, 4 UpdateAmp.

use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::instructions::{add_liquidity, initialize_pool, remove_liquidity, swap, update_amp};

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .first()
        .copied()
        .ok_or(ProgramError::InvalidInstructionData)?;
    let data = instruction_data.get(1..).unwrap_or_default();

    match discriminator {
        0 => {
            let args: InitializePoolArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            initialize_pool::process(
                program_id,
                accounts,
                args.amp_factor,
                args.swap_fee_bps,
                args.protocol_fee_bps,
                args.creator_fee_bps,
            )
        }
        1 => {
            let args: SwapArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            swap::process(
                program_id,
                accounts,
                args.amount_in,
                args.minimum_amount_out,
                args.a_to_b,
            )
        }
        2 => {
            let args: AddLiquidityArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            add_liquidity::process(
                program_id,
                accounts,
                args.amount_a,
                args.amount_b,
                args.min_lp_tokens,
            )
        }
        3 => {
            let args: RemoveLiquidityArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            remove_liquidity::process(
                program_id,
                accounts,
                args.lp_tokens,
                args.min_amount_a,
                args.min_amount_b,
            )
        }
        4 => {
            let args: UpdateAmpArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            update_amp::process(program_id, accounts, args.target_amp)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[derive(BorshDeserialize)]
struct InitializePoolArgs {
    amp_factor: u64,
    swap_fee_bps: u64,
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
}

#[derive(BorshDeserialize)]
struct SwapArgs {
    amount_in: u64,
    minimum_amount_out: u64,
    a_to_b: bool,
}

#[derive(BorshDeserialize)]
struct AddLiquidityArgs {
    amount_a: u64,
    amount_b: u64,
    min_lp_tokens: u64,
}

#[derive(BorshDeserialize)]
struct RemoveLiquidityArgs {
    lp_tokens: u64,
    min_amount_a: u64,
    min_amount_b: u64,
}

#[derive(BorshDeserialize)]
struct UpdateAmpArgs {
    target_amp: u64,
}
