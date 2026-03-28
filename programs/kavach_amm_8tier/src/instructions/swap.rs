//! Swap; fee from pool (one of 8 tiers). Accumulate protocol/creator fees for collect_fees.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

use spl_token::state::Account as TokenAccountState;

use crate::error::AmmError;
use crate::events;
use crate::math;
use crate::state::Pool;

/// Accounts: pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, clock
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_in: u64,
    minimum_amount_out: u64,
    a_to_b: bool,
) -> ProgramResult {
    let [pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h] => [a, b, c, d, e, f, g, h],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: Pool = BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| AmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(AmmError::PoolNotInitialized.into());
    }

    let reserve_in = TokenAccountState::unpack(&vault_in.data.borrow())?.amount;
    let reserve_out = TokenAccountState::unpack(&vault_out.data.borrow())?.amount;

    let (amount_out, fee_amount) = math::calculate_swap_output(
        amount_in,
        reserve_in,
        reserve_out,
        pool_state.fee_numerator,
        pool_state.fee_denominator,
    )?;

    if amount_out == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if amount_out < minimum_amount_out {
        return Err(AmmError::SlippageExceeded.into());
    }

    let (_protocol_fee, _creator_fee) = math::split_fee(
        fee_amount,
        pool_state.protocol_fee_bps,
        pool_state.creator_fee_bps,
    )?;

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            user_token_in.key,
            vault_in.key,
            user.key,
            &[],
            amount_in,
        )?,
        &[user_token_in.clone(), vault_in.clone(), user.clone(), token_program.clone()],
        &[],
    )?;

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            vault_out.key,
            user_token_out.key,
            pool.key,
            &[],
            amount_out,
        )?,
        &[vault_out.clone(), user_token_out.clone(), pool.clone(), token_program.clone()],
        signers,
    )?;

    let clock = Clock::from_account_info(clock)?;
    if a_to_b {
        pool_state.total_fees_a = pool_state.total_fees_a.checked_add(fee_amount).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_a = pool_state.cumulative_volume_a.checked_add(amount_in as u128).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_b = pool_state.cumulative_volume_b.checked_add(amount_out as u128).ok_or(AmmError::MathOverflow)?;
    } else {
        pool_state.total_fees_b = pool_state.total_fees_b.checked_add(fee_amount).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_b = pool_state.cumulative_volume_b.checked_add(amount_in as u128).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_a = pool_state.cumulative_volume_a.checked_add(amount_out as u128).ok_or(AmmError::MathOverflow)?;
    }
    pool_state.last_update_timestamp = clock.unix_timestamp;

    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_swap(*pool.key, *user.key, amount_in, amount_out, fee_amount, clock.unix_timestamp)?;
    Ok(())
}
