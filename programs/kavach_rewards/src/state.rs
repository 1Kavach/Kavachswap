//! Account layouts and PDA helpers.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, pubkey_eq, Pubkey},
};

pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_FARM: &[u8] = b"farm";
pub const SEED_STAKE: &[u8] = b"stake";

/// `spl_associated_token_account` program id (AToken...).
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey = [
    140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218,
    255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
];

pub const GLOBAL_VERSION: u8 = 1;
pub const GLOBAL_LEN: usize = 34;
/// [0]=version [1]=bump [2..34]=authority
pub fn global_write(data: &mut [u8], authority: &Pubkey, bump: u8) {
    data[0] = GLOBAL_VERSION;
    data[1] = bump;
    data[2..34].copy_from_slice(authority);
}

pub fn global_read(data: &[u8]) -> Result<(u8, Pubkey), ProgramError> {
    if data.len() < GLOBAL_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[0] != GLOBAL_VERSION {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&data[2..34]);
    Ok((data[1], pk))
}

pub const FARM_VERSION: u8 = 1;
/// LP/reward vault ATAs are owned by the **farm PDA** (this program signs with `["farm", lp_mint, bump]`).
pub const FARM_LEN: usize = 171;

#[allow(clippy::too_many_arguments)]
pub fn farm_write(
    data: &mut [u8],
    farm_bump: u8,
    lp_mint: &Pubkey,
    reward_mint: &Pubkey,
    stake_vault: &Pubkey,
    reward_vault: &Pubkey,
    reward_rate: u64,
    last_update: i64,
    acc: u128,
    total_staked: u64,
    paused: bool,
) {
    data[0] = FARM_VERSION;
    data[1] = farm_bump;
    data[2] = if paused { 1 } else { 0 };
    data[3..35].copy_from_slice(lp_mint);
    data[35..67].copy_from_slice(reward_mint);
    data[67..99].copy_from_slice(stake_vault);
    data[99..131].copy_from_slice(reward_vault);
    data[131..139].copy_from_slice(&reward_rate.to_le_bytes());
    data[139..147].copy_from_slice(&last_update.to_le_bytes());
    data[147..163].copy_from_slice(&acc.to_le_bytes());
    data[163..171].copy_from_slice(&total_staked.to_le_bytes());
}

pub struct FarmState {
    pub farm_bump: u8,
    pub paused: bool,
    pub lp_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub reward_rate: u64,
    pub last_update: i64,
    pub acc_reward_per_share: u128,
    pub total_staked: u64,
}

pub fn farm_read(data: &[u8]) -> Result<FarmState, ProgramError> {
    if data.len() < FARM_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[0] != FARM_VERSION {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut lp_mint = [0u8; 32];
    let mut reward_mint = [0u8; 32];
    let mut stake_vault = [0u8; 32];
    let mut reward_vault = [0u8; 32];
    lp_mint.copy_from_slice(&data[3..35]);
    reward_mint.copy_from_slice(&data[35..67]);
    stake_vault.copy_from_slice(&data[67..99]);
    reward_vault.copy_from_slice(&data[99..131]);
    Ok(FarmState {
        farm_bump: data[1],
        paused: data[2] != 0,
        lp_mint,
        reward_mint,
        stake_vault,
        reward_vault,
        reward_rate: u64::from_le_bytes(data[131..139].try_into().unwrap()),
        last_update: i64::from_le_bytes(data[139..147].try_into().unwrap()),
        acc_reward_per_share: u128::from_le_bytes(data[147..163].try_into().unwrap()),
        total_staked: u64::from_le_bytes(data[163..171].try_into().unwrap()),
    })
}

pub fn farm_write_from_state(data: &mut [u8], s: &FarmState) {
    farm_write(
        data,
        s.farm_bump,
        &s.lp_mint,
        &s.reward_mint,
        &s.stake_vault,
        &s.reward_vault,
        s.reward_rate,
        s.last_update,
        s.acc_reward_per_share,
        s.total_staked,
        s.paused,
    );
}

pub const STAKE_VERSION: u8 = 1;
pub const STAKE_LEN: usize = 32;

pub fn stake_write(data: &mut [u8], amount: u64, reward_debt: u128) {
    data.fill(0);
    data[0] = STAKE_VERSION;
    data[1..9].copy_from_slice(&amount.to_le_bytes());
    data[9..25].copy_from_slice(&reward_debt.to_le_bytes());
}

pub struct UserStakeState {
    pub amount: u64,
    pub reward_debt: u128,
}

pub fn stake_read(data: &[u8]) -> Result<UserStakeState, ProgramError> {
    if data.len() < STAKE_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[0] == 0 {
        return Ok(UserStakeState {
            amount: 0,
            reward_debt: 0,
        });
    }
    if data[0] != STAKE_VERSION {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(UserStakeState {
        amount: u64::from_le_bytes(data[1..9].try_into().unwrap()),
        reward_debt: u128::from_le_bytes(data[9..25].try_into().unwrap()),
    })
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[SEED_CONFIG], program_id)
}

pub fn farm_pda(lp_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[SEED_FARM, lp_mint.as_ref()], program_id)
}

pub fn stake_pda(farm: &Pubkey, user: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[SEED_STAKE, farm.as_ref(), user.as_ref()], program_id)
}

pub fn associated_token_address(wallet: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    find_program_address(
        &[
            wallet.as_ref(),
            token_program.as_ref(),
            mint.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

/// Native system program (`11111111111111111111111111111111`).
pub const NATIVE_SYSTEM_PROGRAM_ID: Pubkey = [0u8; 32];

pub fn verify_system_program(ai: &AccountInfo) -> Result<(), ProgramError> {
    if pubkey_eq(ai.key(), &NATIVE_SYSTEM_PROGRAM_ID) {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

pub fn verify_rent(ai: &AccountInfo) -> Result<(), ProgramError> {
    if pubkey_eq(ai.key(), &pinocchio::sysvars::rent::RENT_ID) {
        Ok(())
    } else {
        Err(ProgramError::InvalidArgument)
    }
}

pub fn verify_clock(ai: &AccountInfo) -> Result<(), ProgramError> {
    if pubkey_eq(ai.key(), &pinocchio::sysvars::clock::CLOCK_ID) {
        Ok(())
    } else {
        Err(ProgramError::InvalidArgument)
    }
}

pub const ACC_PRECISION: u128 = 1_000_000_000_000;

pub fn update_farm_acc(farm: &mut FarmState, now: i64) {
    if farm.total_staked == 0 || farm.reward_rate == 0 {
        farm.last_update = now;
        return;
    }
    let dt = now.saturating_sub(farm.last_update);
    if dt <= 0 {
        return;
    }
    let dt_u = dt as u128;
    let reward = dt_u.saturating_mul(farm.reward_rate as u128);
    let add = reward
        .saturating_mul(ACC_PRECISION)
        .checked_div(farm.total_staked as u128)
        .unwrap_or(0);
    farm.acc_reward_per_share = farm.acc_reward_per_share.saturating_add(add);
    farm.last_update = now;
}

pub fn pending_rewards(amount: u64, acc: u128, debt: u128) -> u128 {
    (amount as u128)
        .saturating_mul(acc)
        .checked_div(ACC_PRECISION)
        .unwrap_or(0)
        .saturating_sub(debt)
}

pub fn debt_for_amount(amount: u64, acc: u128) -> u128 {
    (amount as u128)
        .saturating_mul(acc)
        .checked_div(ACC_PRECISION)
        .unwrap_or(0)
}
