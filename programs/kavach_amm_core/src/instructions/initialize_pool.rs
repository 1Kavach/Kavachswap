//! Create pool PDA, vaults, LP mint. Multiple fee tiers. Full Token-2022: two token programs (same or mixed).

use borsh::BorshSerialize;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use spl_token::state::{Account as TokenAccountState, Mint as MintState};

use crate::error::AmmError;
use crate::state::Pool;

const LP_DECIMALS: u8 = 9;
const FEE_DENOMINATOR: u64 = 10_000;

/// Allowed fee numerators (per 10000): 0.01%, 0.05%, 0.1%, 0.25%, 0.5%, 0.8%, 1%, 1.25%, 1.5%, 2%, 2.5%, 3%, 4%.
const ALLOWED_FEE_NUMERATORS: [u64; 13] = [1, 5, 10, 25, 50, 80, 100, 125, 150, 200, 250, 300, 400];

/// Accounts: pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault,
/// lp_mint, protocol_fee_recipient, creator_fee_recipient, payer,
/// system_program, token_program, rent_sysvar, token_program_b (for mixed SPL+Token-2022; same as token_program for same-program)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    fee_numerator: u64,
    fee_denominator: u64,
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
) -> ProgramResult {
    let [pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault, lp_mint, protocol_recipient, creator_recipient, payer, system_program, token_program, rent_sysvar, token_program_b] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if token_a_mint.key >= token_b_mint.key {
        return Err(AmmError::InvalidTokenOrder.into());
    }
    if protocol_fee_bps + creator_fee_bps != 10000 {
        return Err(AmmError::InvalidFeeSplit.into());
    }
    if fee_denominator == 0 || fee_numerator >= fee_denominator {
        return Err(AmmError::InvalidFeeParameters.into());
    }

    if fee_denominator != FEE_DENOMINATOR || !ALLOWED_FEE_NUMERATORS.contains(&fee_numerator) {
        return Err(AmmError::InvalidFeeTier.into());
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !solana_program::sysvar::rent::check_id(rent_sysvar.key) {
        return Err(AmmError::InvalidSysvar.into());
    }
    if system_program.key != &solana_program::system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let valid_token = token_program.key == &spl_token::id() || token_program.key == &spl_token_2022::id();
    let valid_token_b = token_program_b.key == &spl_token::id() || token_program_b.key == &spl_token_2022::id();
    if !valid_token || !valid_token_b {
        return Err(AmmError::InvalidTokenAccount.into());
    }

    let (pool_pda, bump) = Pubkey::find_program_address(
        &[b"pool", token_a_mint.key.as_ref(), token_b_mint.key.as_ref()],
        program_id,
    );
    if pool.key != &pool_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = Rent::from_account_info(rent_sysvar)?;
    let pool_rent = rent.minimum_balance(Pool::LEN);
    let mint_rent = rent.minimum_balance(MintState::get_packed_len());
    let account_rent = rent.minimum_balance(TokenAccountState::get_packed_len());

    let pool_seeds: &[&[u8]] = &[
        b"pool",
        token_a_mint.key.as_ref(),
        token_b_mint.key.as_ref(),
        &[bump],
    ];
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            pool.key,
            pool_rent,
            Pool::LEN as u64,
            program_id,
        ),
        &[payer.clone(), pool.clone(), system_program.clone()],
        &[pool_seeds],
    )?;

    // Token A vault: always with token_program (A side)
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

    // Token B vault: token_program_b (for mixed SPL+2022; when same-program, token_program_b == token_program)
    invoke(
        &system_instruction::create_account(
            payer.key,
            token_b_vault.key,
            account_rent,
            TokenAccountState::get_packed_len() as u64,
            token_program_b.key,
        ),
        &[payer.clone(), token_b_vault.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(
            token_program_b.key,
            token_b_vault.key,
            token_b_mint.key,
            pool.key,
        )?,
        &[token_b_vault.clone(), token_b_mint.clone(), pool.clone(), token_program_b.clone()],
    )?;

    // LP mint: use token_program (A side) for simplicity
    invoke(
        &system_instruction::create_account(
            payer.key,
            lp_mint.key,
            mint_rent,
            MintState::get_packed_len() as u64,
            token_program.key,
        ),
        &[payer.clone(), lp_mint.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_mint2(
            token_program.key,
            lp_mint.key,
            pool.key,
            None,
            LP_DECIMALS,
        )?,
        &[lp_mint.clone(), pool.clone(), token_program.clone()],
    )?;

    let pool_state = Pool {
        is_initialized: true,
        bump,
        token_a_mint: *token_a_mint.key,
        token_b_mint: *token_b_mint.key,
        token_a_vault: *token_a_vault.key,
        token_b_vault: *token_b_vault.key,
        lp_mint: *lp_mint.key,
        lp_token_program: *token_program.key,
        fee_numerator,
        fee_denominator,
        protocol_fee_recipient: *protocol_recipient.key,
        creator_fee_recipient: *creator_recipient.key,
        protocol_fee_bps,
        creator_fee_bps,
        total_fees_a: 0,
        total_fees_b: 0,
        cumulative_volume_a: 0,
        cumulative_volume_b: 0,
        last_update_timestamp: 0,
    };

    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool.data.borrow_mut()[..bytes.len()].copy_from_slice(&bytes);
    Ok(())
}
