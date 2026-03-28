//! Update amplification factor (admin only). No time ramp in v1 — single-tx set.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::error::AmmError;
use crate::state::Pool;

/// Accounts: pool, admin (signer)
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], target_amp: u64) -> ProgramResult {
    let [pool, admin] = match accounts {
        [a, b] => [a, b],
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
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
    if admin.key != &pool_state.admin {
        return Err(AmmError::Unauthorized.into());
    }
    if target_amp == 0 || target_amp > 100_000 {
        return Err(AmmError::InvalidAmpFactor.into());
    }

    pool_state.amp_factor = target_amp;
    let bytes = pool_state.try_to_vec().map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);
    Ok(())
}
