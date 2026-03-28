//! **First deposit only** (empty pool): same accounts as [`add_liquidity`], but the user supplies
//! `amount_a` plus a **human** ratio **token B per 1 token A** as `price_numerator / price_denominator`.
//! The program derives `amount_b` with the same formula as the TS helper `computeAmountBRawForListingPrice`
//! and then runs the normal add-liquidity path. **No price is stored on-chain** — only reserves matter;
//! this instruction only fixes the **initial reserve ratio** (listing) in one step.

use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

use crate::error::AmmError;
use crate::instructions::add_liquidity;
use crate::math;
use crate::state::Pool;
use crate::token_io;

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_a: u64,
    price_numerator: u128,
    price_denominator: u128,
    min_lp_tokens: u64,
) -> ProgramResult {
    let [pool, token_a_vault, token_b_vault, lp_mint, _user_token_a, _user_token_b, _user_lp_token, user, mint_a, mint_b, token_program_a, token_program_b, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(solana_program::program_error::ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(solana_program::program_error::ProgramError::MissingRequiredSignature);
    }
    if !solana_program::sysvar::clock::check_id(clock.key) {
        return Err(AmmError::InvalidSysvar.into());
    }
    Clock::from_account_info(clock).map_err(|_| AmmError::InvalidSysvar)?;

    if !token_io::is_allowed_token_program(token_program_a.key)
        || !token_io::is_allowed_token_program(token_program_b.key)
    {
        return Err(AmmError::InvalidTokenAccount.into());
    }

    let pool_data = pool.data.borrow();
    let pool_state: Pool =
        BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| AmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(AmmError::PoolNotInitialized.into());
    }
    if pool.owner != program_id {
        return Err(solana_program::program_error::ProgramError::IncorrectProgramId);
    }
    if token_a_vault.key != &pool_state.token_a_vault
        || token_b_vault.key != &pool_state.token_b_vault
        || lp_mint.key != &pool_state.lp_mint
    {
        return Err(AmmError::InvalidVault.into());
    }
    if mint_a.key != &pool_state.token_a_mint || mint_b.key != &pool_state.token_b_mint {
        return Err(AmmError::InvalidVault.into());
    }

    let reserve_a = token_io::account_amount(&token_a_vault.data.borrow(), token_program_a.key)?;
    let reserve_b = token_io::account_amount(&token_b_vault.data.borrow(), token_program_b.key)?;
    let lp_supply = token_io::mint_supply(&lp_mint.data.borrow(), &pool_state.lp_token_program)?;

    if reserve_a != 0 || reserve_b != 0 || lp_supply != 0 {
        return Err(AmmError::NotInitialLiquidity.into());
    }
    if amount_a == 0 {
        return Err(AmmError::InvalidAmount.into());
    }

    let decimals_a = token_io::mint_decimals(&mint_a.data.borrow(), token_program_a.key)?;
    let decimals_b = token_io::mint_decimals(&mint_b.data.borrow(), token_program_b.key)?;

    let amount_b = math::amount_b_for_human_price_b_per_a(
        amount_a,
        price_numerator,
        price_denominator,
        decimals_a,
        decimals_b,
    )?;

    drop(pool_data);

    add_liquidity::process_with_amounts(program_id, accounts, amount_a, amount_b, min_lp_tokens)
}
