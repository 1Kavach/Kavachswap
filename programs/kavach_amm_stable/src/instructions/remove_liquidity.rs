//! Remove liquidity; burn LP; `transfer_checked` from vaults.

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
    lp_tokens: u64,
    min_amount_a: u64,
    min_amount_b: u64,
) -> ProgramResult {
    let [pool, token_a_vault, token_b_vault, lp_mint, user_token_a, user_token_b, user_lp_token, user, mint_a, mint_b, token_program_a, token_program_b, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !solana_program::sysvar::clock::check_id(clock.key) {
        return Err(AmmError::InvalidSysvar.into());
    }
    let clock_sysvar = Clock::from_account_info(clock).map_err(|_| AmmError::InvalidSysvar)?;
    let timestamp = clock_sysvar.unix_timestamp;

    if !token_io::is_allowed_token_program(token_program_a.key)
        || !token_io::is_allowed_token_program(token_program_b.key)
    {
        return Err(AmmError::InvalidTokenAccount.into());
    }

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: Pool =
        BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| AmmError::PoolNotInitialized)?;
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
    if lp_tokens == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if mint_a.key != &pool_state.token_a_mint || mint_b.key != &pool_state.token_b_mint {
        return Err(AmmError::InvalidMint.into());
    }

    let reserve_a = token_io::account_amount(&token_a_vault.data.borrow(), token_program_a.key)?;
    let reserve_b = token_io::account_amount(&token_b_vault.data.borrow(), token_program_b.key)?;
    let total_lp = token_io::mint_supply(&lp_mint.data.borrow(), &pool_state.lp_token_program)?;

    let (amount_a, amount_b) = math::calculate_withdrawal_amounts(lp_tokens, reserve_a, reserve_b, total_lp)?;
    if amount_a < min_amount_a || amount_b < min_amount_b {
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
        &spl_token::instruction::burn(
            &pool_state.lp_token_program,
            user_lp_token.key,
            lp_mint.key,
            user.key,
            &[],
            lp_tokens,
        )?,
        &[user_lp_token.clone(), lp_mint.clone(), user.clone(), lp_prog],
    )?;

    invoke_signed(
        &spl_token::instruction::transfer_checked(
            token_program_a.key,
            token_a_vault.key,
            mint_a.key,
            user_token_a.key,
            pool.key,
            &[],
            amount_a,
            decimals_a,
        )?,
        &[
            token_a_vault.clone(),
            user_token_a.clone(),
            mint_a.clone(),
            pool.clone(),
            token_program_a.clone(),
        ],
        signers,
    )?;

    invoke_signed(
        &spl_token::instruction::transfer_checked(
            token_program_b.key,
            token_b_vault.key,
            mint_b.key,
            user_token_b.key,
            pool.key,
            &[],
            amount_b,
            decimals_b,
        )?,
        &[
            token_b_vault.clone(),
            user_token_b.clone(),
            mint_b.clone(),
            pool.clone(),
            token_program_b.clone(),
        ],
        signers,
    )?;

    pool_state.last_update_timestamp = timestamp;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_remove_liquidity(*pool.key, *user.key, lp_tokens, amount_a, amount_b, timestamp)?;
    Ok(())
}
