//! Transfer accumulated fees to protocol and creator ATAs. Token-2022: transfer_checked with mint + decimals.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::error::AmmError;
use crate::math;
use crate::state::Pool;
use crate::token_io::{self, get_associated_token_address_with_program};

/// Accounts: pool, token_a_vault, token_b_vault,
/// protocol_ata_a, creator_ata_a, protocol_ata_b, creator_ata_b,
/// mint_a, mint_b, token_program_a, token_program_b, protocol_fee_recipient, creator_fee_recipient
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [pool, token_a_vault, token_b_vault, protocol_ata_a, creator_ata_a, protocol_ata_b, creator_ata_b, mint_a, mint_b, token_program_a, token_program_b, protocol_fee_recipient, creator_fee_recipient] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !protocol_fee_recipient.is_signer && !creator_fee_recipient.is_signer {
        return Err(AmmError::Unauthorized.into());
    }
    if pool.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    if !token_io::is_allowed_token_program(token_program_a.key) || !token_io::is_allowed_token_program(token_program_b.key) {
        return Err(AmmError::InvalidTokenAccount.into());
    }

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: Pool = BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| AmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(AmmError::PoolNotInitialized.into());
    }
    if token_a_vault.key != &pool_state.token_a_vault || token_b_vault.key != &pool_state.token_b_vault {
        return Err(AmmError::InvalidVault.into());
    }
    if protocol_fee_recipient.key != &pool_state.protocol_fee_recipient || creator_fee_recipient.key != &pool_state.creator_fee_recipient {
        return Err(AmmError::InvalidFeeRecipient.into());
    }

    let expected_protocol_ata_a = get_associated_token_address_with_program(&pool_state.protocol_fee_recipient, &pool_state.token_a_mint, token_program_a.key);
    let expected_creator_ata_a = get_associated_token_address_with_program(&pool_state.creator_fee_recipient, &pool_state.token_a_mint, token_program_a.key);
    let expected_protocol_ata_b = get_associated_token_address_with_program(&pool_state.protocol_fee_recipient, &pool_state.token_b_mint, token_program_b.key);
    let expected_creator_ata_b = get_associated_token_address_with_program(&pool_state.creator_fee_recipient, &pool_state.token_b_mint, token_program_b.key);
    if protocol_ata_a.key != &expected_protocol_ata_a
        || creator_ata_a.key != &expected_creator_ata_a
        || protocol_ata_b.key != &expected_protocol_ata_b
        || creator_ata_b.key != &expected_creator_ata_b
    {
        return Err(AmmError::InvalidFeeRecipient.into());
    }
    if mint_a.key != &pool_state.token_a_mint || mint_b.key != &pool_state.token_b_mint {
        return Err(AmmError::InvalidVault.into());
    }

    let total_fees_a = pool_state.total_fees_a;
    let total_fees_b = pool_state.total_fees_b;
    if total_fees_a == 0 && total_fees_b == 0 {
        return Ok(());
    }

    let decimals_a = token_io::mint_decimals(&mint_a.data.borrow(), token_program_a.key)?;
    let decimals_b = token_io::mint_decimals(&mint_b.data.borrow(), token_program_b.key)?;

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    let (protocol_fee_a, creator_fee_a) = math::split_fee(total_fees_a, pool_state.protocol_fee_bps, pool_state.creator_fee_bps)?;
    let (protocol_fee_b, creator_fee_b) = math::split_fee(total_fees_b, pool_state.protocol_fee_bps, pool_state.creator_fee_bps)?;

    if protocol_fee_a > 0 {
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                token_program_a.key,
                token_a_vault.key,
                mint_a.key,
                protocol_ata_a.key,
                pool.key,
                &[],
                protocol_fee_a,
                decimals_a,
            )?,
            &[token_a_vault.clone(), protocol_ata_a.clone(), mint_a.clone(), pool.clone(), token_program_a.clone()],
            signers,
        )?;
    }
    if creator_fee_a > 0 {
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                token_program_a.key,
                token_a_vault.key,
                mint_a.key,
                creator_ata_a.key,
                pool.key,
                &[],
                creator_fee_a,
                decimals_a,
            )?,
            &[token_a_vault.clone(), creator_ata_a.clone(), mint_a.clone(), pool.clone(), token_program_a.clone()],
            signers,
        )?;
    }
    if protocol_fee_b > 0 {
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                token_program_b.key,
                token_b_vault.key,
                mint_b.key,
                protocol_ata_b.key,
                pool.key,
                &[],
                protocol_fee_b,
                decimals_b,
            )?,
            &[token_b_vault.clone(), protocol_ata_b.clone(), mint_b.clone(), pool.clone(), token_program_b.clone()],
            signers,
        )?;
    }
    if creator_fee_b > 0 {
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                token_program_b.key,
                token_b_vault.key,
                mint_b.key,
                creator_ata_b.key,
                pool.key,
                &[],
                creator_fee_b,
                decimals_b,
            )?,
            &[token_b_vault.clone(), creator_ata_b.clone(), mint_b.clone(), pool.clone(), token_program_b.clone()],
            signers,
        )?;
    }

    pool_state.total_fees_a = 0;
    pool_state.total_fees_b = 0;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}
