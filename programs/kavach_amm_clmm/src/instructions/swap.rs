//! Swap across bins (router-compatible: 8 accounts). Fee on input; 50/50 accumulated for collect_fees.

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

use crate::error::ClmmError;
use crate::events;
use crate::math;
use crate::state::{Bin, Pool, BINS_REGION_LEN, NUM_BINS};

/// Accounts: pool, vault_in, vault_out, user_token_in, user_token_out, user, token_program, clock (router-compatible)
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
    let mut pool_state: Pool =
        BorshDeserialize::try_from_slice(&pool_data[0..Pool::LEN]).map_err(|_| ClmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(ClmmError::PoolNotInitialized.into());
    }

    let bins_data = &pool_data[Pool::LEN..Pool::LEN + BINS_REGION_LEN];
    let active = pool_state.active_bin_id as usize;

    let (_reserve_in, _reserve_out) = if a_to_b {
        (TokenAccountState::unpack(&vault_in.data.borrow())?.amount, TokenAccountState::unpack(&vault_out.data.borrow())?.amount)
    } else {
        (TokenAccountState::unpack(&vault_out.data.borrow())?.amount, TokenAccountState::unpack(&vault_in.data.borrow())?.amount)
    };

    let mut best_bin_index = None;
    let mut best_reserve_in = 0u64;
    let mut best_reserve_out = 0u64;

    if a_to_b {
        for i in active..NUM_BINS {
            if let Some(bin) = Bin::read_from_slice(bins_data, i) {
                let (ri, ro) = (bin.reserve_a, bin.reserve_b);
                if ro > 0 {
                    best_bin_index = Some(i);
                    best_reserve_in = ri;
                    best_reserve_out = ro;
                    break;
                }
            }
        }
    } else {
        for i in (0..=active).rev() {
            if let Some(bin) = Bin::read_from_slice(bins_data, i) {
                let (ri, ro) = (bin.reserve_b, bin.reserve_a);
                if ro > 0 {
                    best_bin_index = Some(i);
                    best_reserve_in = ri;
                    best_reserve_out = ro;
                    break;
                }
            }
        }
    }

    let (bin_index, reserve_in_bin, reserve_out_bin) = match best_bin_index {
        Some(i) => (i, best_reserve_in, best_reserve_out),
        None => return Err(ClmmError::InsufficientLiquidity.into()),
    };

    let (amount_out, fee_amount, _consumed) = math::swap_bin(
        amount_in,
        reserve_in_bin,
        reserve_out_bin,
        pool_state.base_fee_bps,
    )?;

    if amount_out == 0 {
        return Err(ClmmError::InvalidAmount.into());
    }
    if amount_out < minimum_amount_out {
        return Err(ClmmError::SlippageExceeded.into());
    }

    let clock = Clock::from_account_info(clock)?;
    if a_to_b {
        pool_state.total_fees_a = pool_state.total_fees_a.saturating_add(fee_amount);
        pool_state.cumulative_volume_a = pool_state.cumulative_volume_a.saturating_add(amount_in as u128);
        pool_state.cumulative_volume_b = pool_state.cumulative_volume_b.saturating_add(amount_out as u128);
    } else {
        pool_state.total_fees_b = pool_state.total_fees_b.saturating_add(fee_amount);
        pool_state.cumulative_volume_b = pool_state.cumulative_volume_b.saturating_add(amount_in as u128);
        pool_state.cumulative_volume_a = pool_state.cumulative_volume_a.saturating_add(amount_out as u128);
    }
    pool_state.last_update_timestamp = clock.unix_timestamp;

    let amount_in_after_fee = amount_in.saturating_sub(fee_amount);
    let mut bin = Bin::read_from_slice(bins_data, bin_index).unwrap_or_default();
    if a_to_b {
        bin.reserve_a = bin.reserve_a.saturating_add(amount_in_after_fee);
        bin.reserve_b = bin.reserve_b.saturating_sub(amount_out);
    } else {
        bin.reserve_b = bin.reserve_b.saturating_add(amount_in_after_fee);
        bin.reserve_a = bin.reserve_a.saturating_sub(amount_out);
    }
    bin.write_to_slice(&mut pool_data[Pool::LEN..], bin_index);

    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[0..bytes.len()].copy_from_slice(&bytes);
    let pool_seeds = pool_state.pool_signer_seeds();
    drop(pool_data);

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

    events::emit_swap(*pool.key, *user.key, amount_in, amount_out, fee_amount, clock.unix_timestamp)?;
    Ok(())
}
