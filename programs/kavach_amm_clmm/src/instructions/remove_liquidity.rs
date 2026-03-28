//! Remove liquidity from a bin; burn position shares and return proportional tokens.

use borsh::BorshDeserialize;
use borsh::BorshSerialize;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::error::ClmmError;
use crate::state::{Bin, Pool, Position, BINS_REGION_LEN, NUM_BINS};

/// Accounts: pool, position, token_a_vault, token_b_vault, user_token_a, user_token_b,
/// user (signer), token_program
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    shares_to_remove: u128,
    min_amount_a: u64,
    min_amount_b: u64,
) -> ProgramResult {
    let [pool, position, token_a_vault, token_b_vault, user_token_a, user_token_b, user, token_program] =
        match accounts {
            [a, b, c, d, e, f, g, h] => [a, b, c, d, e, f, g, h],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };
    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if shares_to_remove == 0 {
        return Err(ClmmError::InvalidAmount.into());
    }

    let mut pool_data = pool.data.borrow_mut();
    let pool_state: Pool =
        BorshDeserialize::try_from_slice(&pool_data[0..Pool::LEN]).map_err(|_| ClmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(ClmmError::PoolNotInitialized.into());
    }

    let mut pos_data = position.data.borrow_mut();
    let mut pos: Position = BorshDeserialize::try_from_slice(&pos_data[0..Position::LEN])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if pos.owner != *user.key {
        return Err(ProgramError::InvalidAccountData);
    }
    if shares_to_remove > pos.liquidity_shares {
        return Err(ClmmError::InsufficientLiquidity.into());
    }

    let bin_index = pos.bin_index as usize;
    if bin_index >= NUM_BINS {
        return Err(ClmmError::BinOutOfRange.into());
    }

    let bins_data = &mut pool_data[Pool::LEN..Pool::LEN + BINS_REGION_LEN];
    let mut bin = Bin::read_from_slice(bins_data, bin_index).ok_or(ClmmError::InsufficientLiquidity)?;
    if bin.liquidity_shares == 0 {
        return Err(ClmmError::InsufficientLiquidity.into());
    }

    let amount_a = (shares_to_remove as u128)
        .checked_mul(bin.reserve_a as u128)
        .and_then(|n| n.checked_div(bin.liquidity_shares))
        .unwrap_or(0) as u64;
    let amount_b = (shares_to_remove as u128)
        .checked_mul(bin.reserve_b as u128)
        .and_then(|n| n.checked_div(bin.liquidity_shares))
        .unwrap_or(0) as u64;
    if amount_a < min_amount_a || amount_b < min_amount_b {
        return Err(ClmmError::SlippageExceeded.into());
    }

    bin.reserve_a = bin.reserve_a.saturating_sub(amount_a);
    bin.reserve_b = bin.reserve_b.saturating_sub(amount_b);
    bin.liquidity_shares = bin.liquidity_shares.saturating_sub(shares_to_remove);
    bin.write_to_slice(bins_data, bin_index);

    pos.liquidity_shares = pos.liquidity_shares.saturating_sub(shares_to_remove);
    let pos_bytes = pos.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pos_data[0..pos_bytes.len()].copy_from_slice(&pos_bytes);
    drop(pos_data);
    drop(pool_data);

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            token_a_vault.key,
            user_token_a.key,
            pool.key,
            &[],
            amount_a,
        )?,
        &[token_a_vault.clone(), user_token_a.clone(), pool.clone(), token_program.clone()],
        signers,
    )?;
    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            token_b_vault.key,
            user_token_b.key,
            pool.key,
            &[],
            amount_b,
        )?,
        &[token_b_vault.clone(), user_token_b.clone(), pool.clone(), token_program.clone()],
        signers,
    )?;
    Ok(())
}
