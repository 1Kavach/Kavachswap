//! Stable swap: Token-2022 aware, **output** fee; CPI to user + protocol + creator ATAs.
//!
//! Accounts (13): pool, vault_in, vault_out, user_token_in, user_token_out, user (signer),
//! mint_a, mint_b, token_program_a, token_program_b, protocol_fee_ata, creator_fee_ata, clock

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

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount_in: u64,
    minimum_amount_out: u64,
    a_to_b: bool,
) -> ProgramResult {
    let [pool, vault_in, vault_out, user_token_in, user_token_out, user, mint_a, mint_b, token_program_a, token_program_b, protocol_fee_ata, creator_fee_ata, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if amount_in == 0 {
        return Err(AmmError::InvalidAmount.into());
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
    let vault_a_ok = vault_in.key == &pool_state.token_a_vault && vault_out.key == &pool_state.token_b_vault;
    let vault_b_ok = vault_in.key == &pool_state.token_b_vault && vault_out.key == &pool_state.token_a_vault;
    if !vault_a_ok && !vault_b_ok {
        return Err(AmmError::InvalidVault.into());
    }
    if mint_a.key != &pool_state.token_a_mint || mint_b.key != &pool_state.token_b_mint {
        return Err(AmmError::InvalidMint.into());
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
    let mint_out = if vault_out.key == &pool_state.token_a_vault {
        mint_a
    } else {
        mint_b
    };
    let decimals_in = if vault_in.key == &pool_state.token_a_vault {
        pool_state.token_a_decimals
    } else {
        pool_state.token_b_decimals
    };
    let decimals_out = if vault_out.key == &pool_state.token_a_vault {
        pool_state.token_a_decimals
    } else {
        pool_state.token_b_decimals
    };

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

    let reserve_in = token_io::account_amount(&vault_in.data.borrow(), program_in_key)?;
    let reserve_out = token_io::account_amount(&vault_out.data.borrow(), program_out_key)?;

    let (user_out, fee_total, protocol_fee, creator_fee, d0, d_after) =
        math::calculate_stable_swap_output(
            amount_in,
            reserve_in,
            reserve_out,
            decimals_in,
            decimals_out,
            pool_state.amp_factor,
            pool_state.swap_fee_bps,
            pool_state.protocol_fee_bps,
            pool_state.creator_fee_bps,
        )?;

    let _ = (d0, d_after);

    if user_out < minimum_amount_out {
        return Err(AmmError::SlippageExceeded.into());
    }

    let gross_out = user_out
        .checked_add(fee_total)
        .ok_or(AmmError::MathOverflow)?;
    if gross_out > reserve_out {
        return Err(AmmError::InsufficientLiquidity.into());
    }

    let expected_protocol_ata = token_io::get_associated_token_address_with_program(
        &pool_state.protocol_fee_recipient,
        mint_out.key,
        program_out_key,
    );
    let expected_creator_ata = token_io::get_associated_token_address_with_program(
        &pool_state.creator_fee_recipient,
        mint_out.key,
        program_out_key,
    );
    if protocol_fee_ata.key != &expected_protocol_ata || creator_fee_ata.key != &expected_creator_ata {
        return Err(AmmError::InvalidFeeRecipient.into());
    }

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

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
        &[
            user_token_in.clone(),
            vault_in.clone(),
            mint_in.clone(),
            user.clone(),
            program_in.clone(),
        ],
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
            user_out,
            decimals_out,
        )?,
        &[
            vault_out.clone(),
            user_token_out.clone(),
            mint_out.clone(),
            pool.clone(),
            program_out.clone(),
        ],
        signers,
    )?;

    if protocol_fee > 0 {
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                program_out.key,
                vault_out.key,
                mint_out.key,
                protocol_fee_ata.key,
                pool.key,
                &[],
                protocol_fee,
                decimals_out,
            )?,
            &[
                vault_out.clone(),
                protocol_fee_ata.clone(),
                mint_out.clone(),
                pool.clone(),
                program_out.clone(),
            ],
            signers,
        )?;
    }
    if creator_fee > 0 {
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                program_out.key,
                vault_out.key,
                mint_out.key,
                creator_fee_ata.key,
                pool.key,
                &[],
                creator_fee,
                decimals_out,
            )?,
            &[
                vault_out.clone(),
                creator_fee_ata.clone(),
                mint_out.clone(),
                pool.clone(),
                program_out.clone(),
            ],
            signers,
        )?;
    }

    if a_to_b {
        pool_state.cumulative_volume_a = pool_state
            .cumulative_volume_a
            .checked_add(amount_in as u128)
            .ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_b = pool_state
            .cumulative_volume_b
            .checked_add(user_out as u128)
            .ok_or(AmmError::MathOverflow)?;
    } else {
        pool_state.cumulative_volume_b = pool_state
            .cumulative_volume_b
            .checked_add(amount_in as u128)
            .ok_or(AmmError::MathOverflow)?;
        pool_state.cumulative_volume_a = pool_state
            .cumulative_volume_a
            .checked_add(user_out as u128)
            .ok_or(AmmError::MathOverflow)?;
    }
    pool_state.total_fees_collected_out = pool_state
        .total_fees_collected_out
        .checked_add(fee_total as u128)
        .ok_or(AmmError::MathOverflow)?;
    pool_state.last_update_timestamp = timestamp;

    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    drop(pool_data);

    events::emit_swap(
        *pool.key,
        *user.key,
        amount_in,
        user_out,
        fee_total,
        timestamp,
    )?;

    Ok(())
}
