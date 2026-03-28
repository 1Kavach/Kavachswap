//! Add liquidity; mint LP tokens to user. Emit event for top LPs.

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
    amount_a: u64,
    amount_b: u64,
    min_lp_tokens: u64,
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
    let lp_supply = MintState::unpack(&lp_mint.data.borrow())?.supply;

    let lp_tokens = math::calculate_lp_tokens(amount_a, amount_b, reserve_a, reserve_b, lp_supply)?;
    if lp_tokens < min_lp_tokens {
        return Err(AmmError::SlippageExceeded.into());
    }

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    invoke_signed(
        &spl_token::instruction::transfer(token_program.key, user_token_a.key, token_a_vault.key, user.key, &[], amount_a)?,
        &[user_token_a.clone(), token_a_vault.clone(), user.clone(), token_program.clone()],
        &[],
    )?;

    invoke_signed(
        &spl_token::instruction::transfer(token_program.key, user_token_b.key, token_b_vault.key, user.key, &[], amount_b)?,
        &[user_token_b.clone(), token_b_vault.clone(), user.clone(), token_program.clone()],
        &[],
    )?;

    invoke_signed(
        &spl_token::instruction::mint_to(token_program.key, lp_mint.key, user_lp_token.key, pool.key, &[], lp_tokens)?,
        &[lp_mint.clone(), user_lp_token.clone(), pool.clone(), token_program.clone()],
        signers,
    )?;

    let clock = Clock::from_account_info(clock)?;
    pool_state.last_update_timestamp = clock.unix_timestamp;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_add_liquidity(*pool.key, *user.key, amount_a, amount_b, lp_tokens, clock.unix_timestamp)?;
    Ok(())
}
