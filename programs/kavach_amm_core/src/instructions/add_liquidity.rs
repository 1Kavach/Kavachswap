//! Add liquidity; mint LP tokens. Token-2022: extension-aware unpack, transfer_checked.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

use crate::error::AmmError;
use crate::events;
use crate::math;
use crate::state::Pool;
use crate::token_io;

/// Accounts: pool, token_a_vault, token_b_vault, lp_mint, user_token_a, user_token_b, user_lp_token, user, mint_a, mint_b, token_program_a, token_program_b, clock
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_a: u64,
    amount_b: u64,
    min_lp_tokens: u64,
) -> ProgramResult {
    process_with_amounts(program_id, accounts, amount_a, amount_b, min_lp_tokens)
}

/// Shared with [`super::add_initial_liquidity`](super::add_initial_liquidity).
pub(crate) fn process_with_amounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_a: u64,
    amount_b: u64,
    min_lp_tokens: u64,
) -> ProgramResult {
    let [pool, token_a_vault, token_b_vault, lp_mint, user_token_a, user_token_b, user_lp_token, user, mint_a, mint_b, token_program_a, token_program_b, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
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
    if token_a_vault.key != &pool_state.token_a_vault
        || token_b_vault.key != &pool_state.token_b_vault
        || lp_mint.key != &pool_state.lp_mint
    {
        return Err(AmmError::InvalidVault.into());
    }
    if amount_a == 0 && amount_b == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if mint_a.key != &pool_state.token_a_mint || mint_b.key != &pool_state.token_b_mint {
        return Err(AmmError::InvalidVault.into());
    }

    let reserve_a = token_io::account_amount(&token_a_vault.data.borrow(), token_program_a.key)?;
    let reserve_b = token_io::account_amount(&token_b_vault.data.borrow(), token_program_b.key)?;
    let lp_supply = token_io::mint_supply(&lp_mint.data.borrow(), &pool_state.lp_token_program)?;

    let lp_tokens = math::calculate_lp_tokens(amount_a, amount_b, reserve_a, reserve_b, lp_supply)?;
    if lp_tokens < min_lp_tokens {
        return Err(AmmError::SlippageExceeded.into());
    }

    let decimals_a = token_io::mint_decimals(&mint_a.data.borrow(), token_program_a.key)?;
    let decimals_b = token_io::mint_decimals(&mint_b.data.borrow(), token_program_b.key)?;

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];
    let lp_prog = if token_program_a.key == &pool_state.lp_token_program {
        token_program_a.clone()
    } else {
        token_program_b.clone()
    };

    invoke(
        &spl_token::instruction::transfer_checked(
            token_program_a.key,
            user_token_a.key,
            mint_a.key,
            token_a_vault.key,
            user.key,
            &[],
            amount_a,
            decimals_a,
        )?,
        &[user_token_a.clone(), token_a_vault.clone(), mint_a.clone(), user.clone(), token_program_a.clone()],
    )?;

    invoke(
        &spl_token::instruction::transfer_checked(
            token_program_b.key,
            user_token_b.key,
            mint_b.key,
            token_b_vault.key,
            user.key,
            &[],
            amount_b,
            decimals_b,
        )?,
        &[user_token_b.clone(), token_b_vault.clone(), mint_b.clone(), user.clone(), token_program_b.clone()],
    )?;

    invoke_signed(
        &spl_token::instruction::mint_to(&pool_state.lp_token_program, lp_mint.key, user_lp_token.key, pool.key, &[], lp_tokens)?,
        &[lp_mint.clone(), user_lp_token.clone(), pool.clone(), lp_prog],
        signers,
    )?;

    pool_state.last_update_timestamp = timestamp;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_add_liquidity(*pool.key, *user.key, amount_a, amount_b, lp_tokens, timestamp)?;
    Ok(())
}
