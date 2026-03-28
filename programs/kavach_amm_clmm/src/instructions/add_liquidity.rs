//! Add liquidity to a single bin. Position PDA tracks user's shares in that bin.

use borsh::BorshDeserialize;
use borsh::BorshSerialize;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::error::ClmmError;
use crate::math;
use crate::state::{Bin, Pool, Position, BINS_REGION_LEN, NUM_BINS};

/// Accounts: pool, position, token_a_vault, token_b_vault, user_token_a, user_token_b,
/// user (signer), token_program, system_program, rent
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    bin_index: u16,
    amount_a: u64,
    amount_b: u64,
    min_shares: u128,
) -> ProgramResult {
    let [pool, position, token_a_vault, token_b_vault, user_token_a, user_token_b, user, token_program, system_program, rent_sysvar] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j] => [a, b, c, d, e, f, g, h, i, j],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };
    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let bin_index_usize = bin_index as usize;
    if bin_index_usize >= NUM_BINS {
        return Err(ClmmError::BinOutOfRange.into());
    }
    if amount_a == 0 && amount_b == 0 {
        return Err(ClmmError::InvalidAmount.into());
    }

    let (position_pda, _) = Pubkey::find_program_address(
        &[
            b"position",
            pool.key.as_ref(),
            user.key.as_ref(),
            &bin_index.to_le_bytes(),
        ],
        program_id,
    );
    if position.key != &position_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut pool_data = pool.data.borrow_mut();
    let pool_state: Pool =
        BorshDeserialize::try_from_slice(&pool_data[0..Pool::LEN]).map_err(|_| ClmmError::PoolNotInitialized)?;
    if !pool_state.is_initialized {
        return Err(ClmmError::PoolNotInitialized.into());
    }

    let bins_data = &mut pool_data[Pool::LEN..Pool::LEN + BINS_REGION_LEN];
    let mut bin = Bin::read_from_slice(bins_data, bin_index_usize).unwrap_or_default();

    let shares = math::bin_shares(
        amount_a,
        amount_b,
        bin.reserve_a,
        bin.reserve_b,
        bin.liquidity_shares,
    )?;
    if shares < min_shares {
        return Err(ClmmError::SlippageExceeded.into());
    }

    let rent = Rent::from_account_info(rent_sysvar)?;
    let position_exists = position.data.borrow().len() >= Position::LEN;

    if !position_exists {
        invoke(
            &system_instruction::create_account(
                user.key,
                position.key,
                rent.minimum_balance(Position::LEN),
                Position::LEN as u64,
                program_id,
            ),
            &[user.clone(), position.clone(), system_program.clone()],
        )?;
        let pos = Position {
            owner: *user.key,
            pool: *pool.key,
            bin_index,
            liquidity_shares: 0,
        };
        let bytes = pos.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
        position.data.borrow_mut()[0..bytes.len()].copy_from_slice(&bytes);
    }

    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            user_token_a.key,
            token_a_vault.key,
            user.key,
            &[],
            amount_a,
        )?,
        &[user_token_a.clone(), token_a_vault.clone(), user.clone(), token_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            user_token_b.key,
            token_b_vault.key,
            user.key,
            &[],
            amount_b,
        )?,
        &[user_token_b.clone(), token_b_vault.clone(), user.clone(), token_program.clone()],
    )?;

    bin.reserve_a = bin.reserve_a.saturating_add(amount_a);
    bin.reserve_b = bin.reserve_b.saturating_add(amount_b);
    bin.liquidity_shares = bin.liquidity_shares.saturating_add(shares);
    bin.write_to_slice(bins_data, bin_index_usize);

    let mut pos_data = position.data.borrow_mut();
    let mut pos: Position = BorshDeserialize::try_from_slice(&pos_data[0..Position::LEN])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    pos.liquidity_shares = pos.liquidity_shares.saturating_add(shares);
    let bytes = pos.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pos_data[0..bytes.len()].copy_from_slice(&bytes);
    Ok(())
}
