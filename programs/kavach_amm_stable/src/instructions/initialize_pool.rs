//! Initialize stable pool PDA, vaults, LP mint. Mixed SPL Token + Token-2022 (same as Core).

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
use crate::state::{Pool, MAX_SWAP_FEE_BPS};
use crate::token_io;

const LP_DECIMALS: u8 = 9;

/// Accounts: pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault, lp_mint,
/// protocol_fee_recipient, creator_fee_recipient, payer, system_program, token_program_a, rent, token_program_b
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amp_factor: u64,
    swap_fee_bps: u64,
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
) -> ProgramResult {
    let [pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault, lp_mint, protocol_recipient, creator_recipient, payer, system_program, token_program_a, rent_sysvar, token_program_b] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if token_a_mint.key >= token_b_mint.key {
        return Err(AmmError::InvalidTokenOrder.into());
    }
    if protocol_fee_bps + creator_fee_bps != 10_000 {
        return Err(AmmError::InvalidFeeSplit.into());
    }
    if swap_fee_bps > MAX_SWAP_FEE_BPS {
        return Err(AmmError::InvalidFeeParameters.into());
    }
    if amp_factor == 0 || amp_factor > 100_000 {
        return Err(AmmError::InvalidAmpFactor.into());
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
    if !token_io::is_allowed_token_program(token_program_a.key)
        || !token_io::is_allowed_token_program(token_program_b.key)
    {
        return Err(AmmError::InvalidTokenAccount.into());
    }

    let (pool_pda, bump) = Pubkey::find_program_address(
        &[b"pool", token_a_mint.key.as_ref(), token_b_mint.key.as_ref()],
        program_id,
    );
    if pool.key != &pool_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let dec_a = token_io::mint_decimals(&token_a_mint.data.borrow(), token_program_a.key)?;
    let dec_b = token_io::mint_decimals(&token_b_mint.data.borrow(), token_program_b.key)?;

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

    invoke(
        &system_instruction::create_account(
            payer.key,
            token_a_vault.key,
            account_rent,
            TokenAccountState::get_packed_len() as u64,
            token_program_a.key,
        ),
        &[payer.clone(), token_a_vault.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(
            token_program_a.key,
            token_a_vault.key,
            token_a_mint.key,
            pool.key,
        )?,
        &[token_a_vault.clone(), token_a_mint.clone(), pool.clone(), token_program_a.clone()],
    )?;

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

    invoke(
        &system_instruction::create_account(
            payer.key,
            lp_mint.key,
            mint_rent,
            MintState::get_packed_len() as u64,
            token_program_a.key,
        ),
        &[payer.clone(), lp_mint.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_mint2(
            token_program_a.key,
            lp_mint.key,
            pool.key,
            None,
            LP_DECIMALS,
        )?,
        &[lp_mint.clone(), pool.clone(), token_program_a.clone()],
    )?;

    let pool_state = Pool {
        is_initialized: true,
        bump,
        admin: *payer.key,
        token_a_mint: *token_a_mint.key,
        token_b_mint: *token_b_mint.key,
        token_a_vault: *token_a_vault.key,
        token_b_vault: *token_b_vault.key,
        lp_mint: *lp_mint.key,
        lp_token_program: *token_program_a.key,
        amp_factor,
        swap_fee_bps,
        protocol_fee_bps,
        creator_fee_bps,
        protocol_fee_recipient: *protocol_recipient.key,
        creator_fee_recipient: *creator_recipient.key,
        token_a_decimals: dec_a,
        token_b_decimals: dec_b,
        total_fees_collected_out: 0,
        cumulative_volume_a: 0,
        cumulative_volume_b: 0,
        last_update_timestamp: 0,
        padding: [0u8; 48],
    };

    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool.data.borrow_mut()[..bytes.len()].copy_from_slice(&bytes);
    Ok(())
}
