//! Create pool PDA (state + bins in one account), vaults. No LP mint; LPs use position accounts per bin.

use borsh::BorshSerialize;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use spl_token::state::Account as TokenAccountState;

use crate::error::ClmmError;
use crate::state::{Pool, BINS_REGION_LEN};

/// Accounts: pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault,
/// protocol_fee_recipient, creator_fee_recipient, payer, system_program, token_program, rent
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    bin_step: u16,
    base_fee_bps: u64,
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
) -> ProgramResult {
    let [pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault, protocol_recipient, creator_recipient, payer, system_program, token_program, rent_sysvar] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k] => [a, b, c, d, e, f, g, h, i, j, k],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if token_a_mint.key >= token_b_mint.key {
        return Err(ClmmError::InvalidTokenOrder.into());
    }
    if bin_step == 0 || bin_step > 10000 {
        return Err(ClmmError::InvalidBinStep.into());
    }
    if base_fee_bps >= 10_000 {
        return Err(ClmmError::InvalidFeeParameters.into());
    }
    if protocol_fee_bps + creator_fee_bps != 10_000 {
        return Err(ClmmError::InvalidFeeSplit.into());
    }

    let (pool_pda, bump) = Pubkey::find_program_address(
        &[b"pool", token_a_mint.key.as_ref(), token_b_mint.key.as_ref()],
        program_id,
    );
    if pool.key != &pool_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = Rent::from_account_info(rent_sysvar)?;
    let pool_rent = rent.minimum_balance(Pool::ACCOUNT_LEN);
    let account_rent = rent.minimum_balance(TokenAccountState::get_packed_len());

    invoke(
        &system_instruction::create_account(
            payer.key,
            pool.key,
            pool_rent,
            Pool::ACCOUNT_LEN as u64,
            program_id,
        ),
        &[payer.clone(), pool.clone(), system_program.clone()],
    )?;

    invoke(
        &system_instruction::create_account(
            payer.key,
            token_a_vault.key,
            account_rent,
            TokenAccountState::get_packed_len() as u64,
            token_program.key,
        ),
        &[payer.clone(), token_a_vault.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            token_a_vault.key,
            token_a_mint.key,
            pool.key,
        )?,
        &[token_a_vault.clone(), token_a_mint.clone(), pool.clone(), token_program.clone()],
    )?;

    invoke(
        &system_instruction::create_account(
            payer.key,
            token_b_vault.key,
            account_rent,
            TokenAccountState::get_packed_len() as u64,
            token_program.key,
        ),
        &[payer.clone(), token_b_vault.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            token_b_vault.key,
            token_b_mint.key,
            pool.key,
        )?,
        &[token_b_vault.clone(), token_b_mint.clone(), pool.clone(), token_program.clone()],
    )?;

    let pool_state = Pool {
        is_initialized: true,
        bump,
        token_a_mint: *token_a_mint.key,
        token_b_mint: *token_b_mint.key,
        token_a_vault: *token_a_vault.key,
        token_b_vault: *token_b_vault.key,
        active_bin_id: (crate::state::NUM_BINS / 2) as u16,
        bin_step,
        base_fee_bps,
        protocol_fee_bps,
        creator_fee_bps,
        protocol_fee_recipient: *protocol_recipient.key,
        creator_fee_recipient: *creator_recipient.key,
        total_fees_a: 0,
        total_fees_b: 0,
        cumulative_volume_a: 0,
        cumulative_volume_b: 0,
        last_update_timestamp: 0,
    };

    let mut pool_data = pool.data.borrow_mut();
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    pool_data[Pool::LEN..Pool::LEN + BINS_REGION_LEN].fill(0);
    Ok(())
}
