//! Transfer accumulated fees to protocol and creator ATAs (50/50 per token).

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
use crate::state::Pool;

/// Accounts: pool, token_a_vault, token_b_vault,
/// protocol_ata_a, creator_ata_a, protocol_ata_b, creator_ata_b, token_program
pub fn process(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [pool, token_a_vault, token_b_vault, protocol_ata_a, creator_ata_a, protocol_ata_b, creator_ata_b, token_program] =
        match accounts {
            [a, b, c, d, e, f, g, h] => [a, b, c, d, e, f, g, h],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: Pool =
        BorshDeserialize::try_from_slice(&pool_data[0..Pool::LEN]).map_err(|_| ClmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(ClmmError::PoolNotInitialized.into());
    }

    let total_fees_a = pool_state.total_fees_a;
    let total_fees_b = pool_state.total_fees_b;
    if total_fees_a == 0 && total_fees_b == 0 {
        return Ok(());
    }

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    let protocol_fee_a = (total_fees_a as u128)
        .checked_mul(pool_state.protocol_fee_bps as u128)
        .and_then(|n| n.checked_div(10_000))
        .unwrap_or(0) as u64;
    let creator_fee_a = total_fees_a.saturating_sub(protocol_fee_a);
    let protocol_fee_b = (total_fees_b as u128)
        .checked_mul(pool_state.protocol_fee_bps as u128)
        .and_then(|n| n.checked_div(10_000))
        .unwrap_or(0) as u64;
    let creator_fee_b = total_fees_b.saturating_sub(protocol_fee_b);

    if protocol_fee_a > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                token_a_vault.key,
                protocol_ata_a.key,
                pool.key,
                &[],
                protocol_fee_a,
            )?,
            &[token_a_vault.clone(), protocol_ata_a.clone(), pool.clone(), token_program.clone()],
            signers,
        )?;
    }
    if creator_fee_a > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                token_a_vault.key,
                creator_ata_a.key,
                pool.key,
                &[],
                creator_fee_a,
            )?,
            &[token_a_vault.clone(), creator_ata_a.clone(), pool.clone(), token_program.clone()],
            signers,
        )?;
    }
    if protocol_fee_b > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                token_b_vault.key,
                protocol_ata_b.key,
                pool.key,
                &[],
                protocol_fee_b,
            )?,
            &[token_b_vault.clone(), protocol_ata_b.clone(), pool.clone(), token_program.clone()],
            signers,
        )?;
    }
    if creator_fee_b > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                token_b_vault.key,
                creator_ata_b.key,
                pool.key,
                &[],
                creator_fee_b,
            )?,
            &[token_b_vault.clone(), creator_ata_b.clone(), pool.clone(), token_program.clone()],
            signers,
        )?;
    }

    pool_state.total_fees_a = 0;
    pool_state.total_fees_b = 0;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[0..bytes.len()].copy_from_slice(&bytes);
    Ok(())
}
