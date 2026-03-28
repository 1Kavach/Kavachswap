//! Burn LP tokens; send token_a and token_b from vaults to user. Emit event.

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

use spl_token::state::{Account as TokenAccountState, Mint as MintState};

use crate::error::AmmError;
use crate::events;
use crate::math;
use crate::state::Pool;

/// Accounts: pool, token_a_vault, token_b_vault, lp_mint, user_token_a, user_token_b, user_lp_token, user, token_program, clock
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    lp_tokens: u64,
    min_amount_a: u64,
    min_amount_b: u64,
) -> ProgramResult {
    let [pool, token_a_vault, token_b_vault, lp_mint, user_token_a, user_token_b, user_lp_token, user, token_program, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j] => [a, b, c, d, e, f, g, h, i, j],
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

    let reserve_a = TokenAccountState::unpack(&token_a_vault.data.borrow())?.amount;
    let reserve_b = TokenAccountState::unpack(&token_b_vault.data.borrow())?.amount;
    let total_lp = MintState::unpack(&lp_mint.data.borrow())?.supply;

    let (amount_a, amount_b) = math::calculate_withdrawal_amounts(lp_tokens, reserve_a, reserve_b, total_lp)?;
    if amount_a < min_amount_a || amount_b < min_amount_b {
        return Err(AmmError::SlippageExceeded.into());
    }

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    invoke_signed(
        &spl_token::instruction::burn(token_program.key, user_lp_token.key, lp_mint.key, user.key, &[], lp_tokens)?,
        &[user_lp_token.clone(), lp_mint.clone(), user.clone(), token_program.clone()],
        &[],
    )?;

    invoke_signed(
        &spl_token::instruction::transfer(token_program.key, token_a_vault.key, user_token_a.key, pool.key, &[], amount_a)?,
        &[token_a_vault.clone(), user_token_a.clone(), pool.clone(), token_program.clone()],
        signers,
    )?;

    invoke_signed(
        &spl_token::instruction::transfer(token_program.key, token_b_vault.key, user_token_b.key, pool.key, &[], amount_b)?,
        &[token_b_vault.clone(), user_token_b.clone(), pool.clone(), token_program.clone()],
        signers,
    )?;

    let clock = Clock::from_account_info(clock)?;
    pool_state.last_update_timestamp = clock.unix_timestamp;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_remove_liquidity(*pool.key, *user.key, lp_tokens, amount_a, amount_b, clock.unix_timestamp)?;
    Ok(())
}
