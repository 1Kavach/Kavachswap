//! Swap; fee from pool per configured tier. Token-2022: extension-aware unpack, transfer_checked (mint + decimals).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

use crate::error::AmmError;
use crate::events;
use crate::math;
use crate::state::Pool;
use crate::token_io;

/// Accounts: pool, vault_in, vault_out, user_token_in, user_token_out, user, mint_a, mint_b, token_program_a, token_program_b, clock
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_in: u64,
    minimum_amount_out: u64,
    a_to_b: bool,
) -> ProgramResult {
    let [pool, vault_in, vault_out, user_token_in, user_token_out, user, mint_a, mint_b, token_program_a, token_program_b, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k] => [a, b, c, d, e, f, g, h, i, j, k],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if amount_in == 0 {
        return Err(AmmError::InvalidAmount.into());
    }

    // Validate clock sysvar before any CPIs or state mutation (audit: defense-in-depth).
    if !solana_program::sysvar::clock::check_id(clock.key) {
        return Err(AmmError::InvalidSysvar.into());
    }
    let clock_sysvar = Clock::from_account_info(clock).map_err(|_| AmmError::InvalidSysvar)?;
    let timestamp = clock_sysvar.unix_timestamp;

    if !token_io::is_allowed_token_program(token_program_a.key) || !token_io::is_allowed_token_program(token_program_b.key) {
        return Err(AmmError::InvalidTokenAccount.into());
    }

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: Pool = BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| AmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(AmmError::PoolNotInitialized.into());
    }
    if pool.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let vault_a_ok = vault_in.key == &pool_state.token_a_vault && vault_out.key == &pool_state.token_b_vault;
    let vault_b_ok = vault_in.key == &pool_state.token_b_vault && vault_out.key == &pool_state.token_a_vault;
    if !vault_a_ok && !vault_b_ok {
        return Err(AmmError::InvalidVault.into());
    }
    if mint_a.key != &pool_state.token_a_mint || mint_b.key != &pool_state.token_b_mint {
        return Err(AmmError::InvalidVault.into());
    }

    let program_in_key = if vault_in.key == &pool_state.token_a_vault {
        token_program_a.key
    } else {
        token_program_b.key
    };
    let program_out_key = if vault_out.key == &pool_state.token_a_vault {
        token_program_a.key
    } else {
        token_program_b.key
    };
    let reserve_in = token_io::account_amount(&vault_in.data.borrow(), program_in_key)?;
    let reserve_out = token_io::account_amount(&vault_out.data.borrow(), program_out_key)?;

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

    let program_in = if vault_in.key == &pool_state.token_a_vault {
        token_program_a
    } else {
        token_program_b
    };
    let program_out = if vault_out.key == &pool_state.token_a_vault {
        token_program_a
    } else {
        token_program_b
    };
    let mint_in = if vault_in.key == &pool_state.token_a_vault {
        mint_a
    } else {
        mint_b
    };
    let mint_out = if vault_out.key == &pool_state.token_a_vault {
        mint_a
    } else {
        mint_b
    };
    let decimals_in = token_io::mint_decimals(&mint_in.data.borrow(), program_in.key)?;
    let decimals_out = token_io::mint_decimals(&mint_out.data.borrow(), program_out.key)?;

    invoke_signed(
        &spl_token::instruction::transfer_checked(
            program_in.key,
            user_token_in.key,
            mint_in.key,
            vault_in.key,
            user.key,
            &[],
            amount_in,
            decimals_in,
        )?,
        &[user_token_in.clone(), vault_in.clone(), mint_in.clone(), user.clone(), program_in.clone()],
        &[],
    )?;

    invoke_signed(
        &spl_token::instruction::transfer_checked(
            program_out.key,
            vault_out.key,
            mint_out.key,
            user_token_out.key,
            pool.key,
            &[],
            amount_out,
            decimals_out,
        )?,
        &[vault_out.clone(), user_token_out.clone(), mint_out.clone(), pool.clone(), program_out.clone()],
        signers,
    )?;

    if a_to_b {
        pool_state.total_fees_a = pool_state.total_fees_a.checked_add(fee_amount).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_a = pool_state.cumulative_volume_a.checked_add(amount_in as u128).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_b = pool_state.cumulative_volume_b.checked_add(amount_out as u128).ok_or(AmmError::MathOverflow)?;
    } else {
        pool_state.total_fees_b = pool_state.total_fees_b.checked_add(fee_amount).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_b = pool_state.cumulative_volume_b.checked_add(amount_in as u128).ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_a = pool_state.cumulative_volume_a.checked_add(amount_out as u128).ok_or(AmmError::MathOverflow)?;
    }
    pool_state.last_update_timestamp = timestamp;

    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_swap(*pool.key, *user.key, amount_in, amount_out, fee_amount, timestamp)?;
    Ok(())
}
