use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{pubkey_eq, Pubkey},
    sysvars::{clock::Clock, rent::Rent},
    ProgramResult,
};
use pinocchio_tkn::{
    common::TransferChecked,
    helpers::{assert_is_mint, assert_is_token_account, assert_owned_by},
    state::Mint,
};

use crate::error::custom;
use crate::error::{
    ERR_ALREADY_INITIALIZED, ERR_INSUFFICIENT_STAKE, ERR_INVALID_DISCRIMINATOR, ERR_MATH,
    ERR_MINT_MISMATCH, ERR_PAUSED, ERR_UNAUTHORIZED, ERR_VAULT_MISMATCH,
};
use crate::state::{
    self, associated_token_address, config_pda, debt_for_amount, farm_pda, farm_read, farm_write_from_state,
    global_read, global_write, pending_rewards, stake_pda, stake_read, stake_write, update_farm_acc,
    verify_clock, verify_rent, verify_system_program, FarmState, UserStakeState, FARM_LEN, GLOBAL_LEN,
    STAKE_LEN,
};
use crate::system_cpi::create_account;

fn read_u64(data: &[u8], off: &mut usize) -> Result<u64, ProgramError> {
    if *off + 8 > data.len() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let v = u64::from_le_bytes(data[*off..*off + 8].try_into().unwrap());
    *off += 8;
    Ok(v)
}

fn read_u8b(data: &[u8], off: &mut usize) -> Result<u8, ProgramError> {
    let b = *data.get(*off).ok_or(ProgramError::InvalidInstructionData)?;
    *off += 1;
    Ok(b)
}

fn load_global_auth(cfg_ai: &AccountInfo) -> Result<Pubkey, ProgramError> {
    let d = cfg_ai.try_borrow_data()?;
    let (_, auth) = global_read(&d)?;
    Ok(auth)
}

/// PDA signer: `["farm", lp_mint, bump]`. `bump_le` must live through `invoke_signed` (e.g. `let b = [bump]; ... b.as_slice()`).
fn farm_signer_seeds3<'a>(lp_mint: &'a Pubkey, bump_le: &'a [u8]) -> [Seed<'a>; 3] {
    [
        Seed::from(state::SEED_FARM),
        Seed::from(lp_mint.as_ref()),
        Seed::from(bump_le),
    ]
}

fn settle_rewards<'a>(
    farm_ai: &'a AccountInfo,
    farm: &FarmState,
    user_stake: &UserStakeState,
    user_reward_ata: &'a AccountInfo,
    reward_vault: &'a AccountInfo,
    reward_mint_ai: &'a AccountInfo,
    _token_rw: &'a AccountInfo,
) -> ProgramResult {
    if user_stake.amount == 0 {
        return Ok(());
    }
    let pending = pending_rewards(
        user_stake.amount,
        farm.acc_reward_per_share,
        user_stake.reward_debt,
    );
    if pending == 0 {
        return Ok(());
    }
    if pending > u64::MAX as u128 {
        return Err(custom(ERR_MATH));
    }
    let dec = Mint::from_account_info(reward_mint_ai)?.decimals();
    let bump = [farm.farm_bump];
    let seeds = farm_signer_seeds3(&farm.lp_mint, bump.as_slice());
    let signer = Signer::from(&seeds[..]);
    TransferChecked {
        source: reward_vault,
        mint: reward_mint_ai,
        destination: user_reward_ata,
        authority: farm_ai,
        amount: pending as u64,
        decimals: dec,
        program_id: None,
    }
    .invoke_signed(&[signer])?;
    Ok(())
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let disc = *data.first().ok_or(ProgramError::InvalidInstructionData)?;
    let mut off = 1usize;
    match disc {
        0 => process_init_global(program_id, accounts),
        1 => {
            let rate = read_u64(data, &mut off)?;
            process_init_farm(program_id, accounts, rate)
        }
        2 => {
            let rate = read_u64(data, &mut off)?;
            process_set_reward_rate(program_id, accounts, rate)
        }
        3 => {
            let p = read_u8b(data, &mut off)?;
            process_set_paused(program_id, accounts, p != 0)
        }
        4 => {
            let amt = read_u64(data, &mut off)?;
            process_fund_rewards(program_id, accounts, amt)
        }
        5 => {
            let amt = read_u64(data, &mut off)?;
            process_stake(program_id, accounts, amt)
        }
        6 => {
            let amt = read_u64(data, &mut off)?;
            process_unstake(program_id, accounts, amt)
        }
        7 => process_claim(program_id, accounts),
        _ => Err(custom(ERR_INVALID_DISCRIMINATOR)),
    }
}

/// 0: `config` PDA, `authority`, `payer`, `system`, `rent`
fn process_init_global(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [config, authority, payer, system_ai, rent_ai] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !authority.is_signer() || !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_system_program(system_ai)?;
    verify_rent(rent_ai)?;

    let (expected_config, config_bump) = config_pda(program_id);
    if !pubkey_eq(config.key(), &expected_config) {
        return Err(ProgramError::InvalidSeeds);
    }
    if config.data_len() >= 1 {
        let cfg_borrow = config.try_borrow_data()?;
        if cfg_borrow[0] == state::GLOBAL_VERSION {
            return Err(custom(ERR_ALREADY_INITIALIZED));
        }
    }

    let rent = Rent::from_account_info(rent_ai)?;
    let lamports = rent.minimum_balance(GLOBAL_LEN);
    let bump_seed = [config_bump];
    let seeds = [Seed::from(state::SEED_CONFIG), Seed::from(bump_seed.as_slice())];
    let signers = [Signer::from(&seeds[..])];

    create_account(
        payer,
        config,
        system_ai,
        program_id,
        GLOBAL_LEN as u64,
        lamports,
        &signers,
    )?;

    let mut d = config.try_borrow_mut_data()?;
    global_write(&mut d, authority.key(), config_bump);
    Ok(())
}

/// 1: `config`, `farm` PDA, `admin`, `lp_mint`, `reward_mint`, `stake_vault`, `reward_vault`,
/// `token_program_lp`, `token_program_reward`, `payer`, `system`, `rent`, `clock`
fn process_init_farm(program_id: &Pubkey, accounts: &[AccountInfo], reward_rate: u64) -> ProgramResult {
    let [cfg_ai, farm_ai, admin, lp_mint_ai, reward_mint_ai, stake_vault, reward_vault, tok_lp, tok_rw, payer, system_ai, rent_ai, clock_ai] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() || !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_system_program(system_ai)?;
    verify_rent(rent_ai)?;
    verify_clock(clock_ai)?;

    let auth = load_global_auth(cfg_ai)?;
    if !pubkey_eq(admin.key(), &auth) {
        return Err(custom(ERR_UNAUTHORIZED));
    }

    let lp_mint_key = *lp_mint_ai.key();
    if !pubkey_eq(lp_mint_ai.owner(), tok_lp.key()) || !pubkey_eq(reward_mint_ai.owner(), tok_rw.key()) {
        return Err(ProgramError::IncorrectProgramId);
    }
    assert_is_mint(lp_mint_ai)?;
    assert_is_mint(reward_mint_ai)?;

    let (expected_farm, farm_bump) = farm_pda(&lp_mint_key, program_id);
    if !pubkey_eq(farm_ai.key(), &expected_farm) {
        return Err(ProgramError::InvalidSeeds);
    }

    let exp_stake = associated_token_address(&expected_farm, &lp_mint_key, tok_lp.key());
    let exp_reward = associated_token_address(&expected_farm, reward_mint_ai.key(), tok_rw.key());
    if !pubkey_eq(stake_vault.key(), &exp_stake) || !pubkey_eq(reward_vault.key(), &exp_reward) {
        return Err(custom(ERR_VAULT_MISMATCH));
    }

    assert_owned_by(stake_vault, tok_lp.key())?;
    assert_owned_by(reward_vault, tok_rw.key())?;
    assert_is_token_account(stake_vault, Some(&lp_mint_key), Some(&expected_farm))?;
    assert_is_token_account(reward_vault, Some(reward_mint_ai.key()), Some(&expected_farm))?;

    let fb = farm_ai.try_borrow_data()?;
    if fb.len() >= 1 && fb[0] == state::FARM_VERSION {
        return Err(custom(ERR_ALREADY_INITIALIZED));
    }
    drop(fb);

    let rent = Rent::from_account_info(rent_ai)?;
    let lamports = rent.minimum_balance(FARM_LEN);
    let bump_seed = [farm_bump];
    let seeds = [
        Seed::from(state::SEED_FARM),
        Seed::from(lp_mint_key.as_ref()),
        Seed::from(bump_seed.as_slice()),
    ];
    let signers = [Signer::from(&seeds[..])];
    create_account(
        payer,
        farm_ai,
        system_ai,
        program_id,
        FARM_LEN as u64,
        lamports,
        &signers,
    )?;

    let clock = Clock::from_account_info(clock_ai)?;
    let now = clock.unix_timestamp;
    let fs = FarmState {
        farm_bump,
        paused: false,
        lp_mint: lp_mint_key,
        reward_mint: *reward_mint_ai.key(),
        stake_vault: *stake_vault.key(),
        reward_vault: *reward_vault.key(),
        reward_rate,
        last_update: now,
        acc_reward_per_share: 0,
        total_staked: 0,
    };
    let mut fd = farm_ai.try_borrow_mut_data()?;
    farm_write_from_state(&mut fd, &fs);
    Ok(())
}

/// 2: `config`, `admin`, `farm`, `clock`
fn process_set_reward_rate(program_id: &Pubkey, accounts: &[AccountInfo], reward_rate: u64) -> ProgramResult {
    let [cfg_ai, admin, farm_ai, clock_ai] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_clock(clock_ai)?;
    let auth = load_global_auth(cfg_ai)?;
    if !pubkey_eq(admin.key(), &auth) {
        return Err(custom(ERR_UNAUTHORIZED));
    }
    let clock = Clock::from_account_info(clock_ai)?;
    let now = clock.unix_timestamp;
    let mut fd = farm_ai.try_borrow_mut_data()?;
    let mut farm = farm_read(&fd)?;
    if !pubkey_eq(farm_ai.key(), &farm_pda(&farm.lp_mint, program_id).0) {
        return Err(ProgramError::InvalidSeeds);
    }
    update_farm_acc(&mut farm, now);
    farm.reward_rate = reward_rate;
    farm_write_from_state(&mut fd, &farm);
    Ok(())
}

/// 3: `config`, `admin`, `farm`, `clock`
fn process_set_paused(program_id: &Pubkey, accounts: &[AccountInfo], paused: bool) -> ProgramResult {
    let [cfg_ai, admin, farm_ai, clock_ai] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_clock(clock_ai)?;
    let auth = load_global_auth(cfg_ai)?;
    if !pubkey_eq(admin.key(), &auth) {
        return Err(custom(ERR_UNAUTHORIZED));
    }
    let clock = Clock::from_account_info(clock_ai)?;
    let now = clock.unix_timestamp;
    let mut fd = farm_ai.try_borrow_mut_data()?;
    let mut farm = farm_read(&fd)?;
    if !pubkey_eq(farm_ai.key(), &farm_pda(&farm.lp_mint, program_id).0) {
        return Err(ProgramError::InvalidSeeds);
    }
    update_farm_acc(&mut farm, now);
    farm.paused = paused;
    farm_write_from_state(&mut fd, &farm);
    Ok(())
}

/// 4: `config`, `admin`, `farm`, `funder_ata`, `reward_vault`, `reward_mint`, `token_program_reward`
fn process_fund_rewards(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let [cfg_ai, admin, farm_ai, funder_ata, reward_vault, reward_mint_ai, tok_rw] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if amount == 0 {
        return Ok(());
    }
    let auth = load_global_auth(cfg_ai)?;
    if !pubkey_eq(admin.key(), &auth) {
        return Err(custom(ERR_UNAUTHORIZED));
    }
    let farm = farm_read(&farm_ai.try_borrow_data()?)?;
    if !pubkey_eq(farm_ai.key(), &farm_pda(&farm.lp_mint, program_id).0) {
        return Err(ProgramError::InvalidSeeds);
    }
    if !pubkey_eq(reward_vault.key(), &farm.reward_vault) {
        return Err(custom(ERR_VAULT_MISMATCH));
    }
    if !pubkey_eq(reward_mint_ai.key(), &farm.reward_mint) {
        return Err(custom(ERR_MINT_MISMATCH));
    }
    assert_owned_by(funder_ata, tok_rw.key())?;
    assert_is_token_account(funder_ata, Some(&farm.reward_mint), Some(admin.key()))?;
    let dec = Mint::from_account_info(reward_mint_ai)?.decimals();
    TransferChecked {
        source: funder_ata,
        mint: reward_mint_ai,
        destination: reward_vault,
        authority: admin,
        amount,
        decimals: dec,
        program_id: None,
    }
    .invoke()?;
    Ok(())
}

/// 5: `farm`, `user_stake` PDA, `user`, `user_lp`, `user_reward_ata`, `stake_vault`, `reward_vault`,
/// `lp_mint`, `reward_mint`, `token_lp`, `token_rw`, `clock`, `payer`, `system`, `rent`
fn process_stake(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let [farm_ai, stake_ai, user, user_lp, user_rw, stake_vault, reward_vault, lp_mint_ai, reward_mint_ai, _tok_lp, tok_rw, clock_ai, payer, system_ai, rent_ai] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !user.is_signer() || !payer.is_signer() || amount == 0 {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_clock(clock_ai)?;
    verify_system_program(system_ai)?;
    verify_rent(rent_ai)?;

    let mut farm = farm_read(&farm_ai.try_borrow_data()?)?;
    if farm.paused {
        return Err(custom(ERR_PAUSED));
    }
    if !pubkey_eq(farm_ai.key(), &farm_pda(&farm.lp_mint, program_id).0) {
        return Err(ProgramError::InvalidSeeds);
    }
    if !pubkey_eq(lp_mint_ai.key(), &farm.lp_mint)
        || !pubkey_eq(stake_vault.key(), &farm.stake_vault)
        || !pubkey_eq(reward_vault.key(), &farm.reward_vault)
    {
        return Err(custom(ERR_VAULT_MISMATCH));
    }

    let (exp_stake_pda, stake_bump) = stake_pda(farm_ai.key(), user.key(), program_id);
    if !pubkey_eq(stake_ai.key(), &exp_stake_pda) {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::from_account_info(clock_ai)?;
    let now = clock.unix_timestamp;
    update_farm_acc(&mut farm, now);

    let mut stake_data = if stake_ai.data_len() == 0 {
        let rent = Rent::from_account_info(rent_ai)?;
        let lamports = rent.minimum_balance(STAKE_LEN);
        let b = [stake_bump];
        let seeds = [
            Seed::from(state::SEED_STAKE),
            Seed::from(farm_ai.key().as_slice()),
            Seed::from(user.key().as_slice()),
            Seed::from(b.as_slice()),
        ];
        let signers = [Signer::from(&seeds[..])];
        create_account(
            payer,
            stake_ai,
            system_ai,
            program_id,
            STAKE_LEN as u64,
            lamports,
            &signers,
        )?;
        UserStakeState {
            amount: 0,
            reward_debt: 0,
        }
    } else {
        stake_read(&stake_ai.try_borrow_data()?)?
    };

    settle_rewards(
        farm_ai,
        &farm,
        &stake_data,
        user_rw,
        reward_vault,
        reward_mint_ai,
        tok_rw,
    )?;

    stake_data.reward_debt = debt_for_amount(stake_data.amount, farm.acc_reward_per_share);

    let dec_lp = Mint::from_account_info(lp_mint_ai)?.decimals();
    TransferChecked {
        source: user_lp,
        mint: lp_mint_ai,
        destination: stake_vault,
        authority: user,
        amount,
        decimals: dec_lp,
        program_id: None,
    }
    .invoke()?;

    farm.total_staked = farm.total_staked.saturating_add(amount);
    stake_data.amount = stake_data.amount.saturating_add(amount);
    stake_data.reward_debt = debt_for_amount(stake_data.amount, farm.acc_reward_per_share);

    {
        let mut s = stake_ai.try_borrow_mut_data()?;
        stake_write(&mut s, stake_data.amount, stake_data.reward_debt);
    }
    {
        let mut fd = farm_ai.try_borrow_mut_data()?;
        farm_write_from_state(&mut fd, &farm);
    }
    Ok(())
}

/// 6: same accounts as stake
fn process_unstake(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let [farm_ai, stake_ai, user, user_lp, user_rw, stake_vault, reward_vault, lp_mint_ai, reward_mint_ai, _tok_lp, tok_rw, clock_ai, _payer, _system_ai, _rent_ai] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !user.is_signer() || amount == 0 {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_clock(clock_ai)?;

    let mut farm = farm_read(&farm_ai.try_borrow_data()?)?;
    if farm.paused {
        return Err(custom(ERR_PAUSED));
    }
    if !pubkey_eq(farm_ai.key(), &farm_pda(&farm.lp_mint, program_id).0) {
        return Err(ProgramError::InvalidSeeds);
    }
    if !pubkey_eq(lp_mint_ai.key(), &farm.lp_mint)
        || !pubkey_eq(stake_vault.key(), &farm.stake_vault)
        || !pubkey_eq(reward_vault.key(), &farm.reward_vault)
    {
        return Err(custom(ERR_VAULT_MISMATCH));
    }

    let (exp_stake_pda, _) = stake_pda(farm_ai.key(), user.key(), program_id);
    if !pubkey_eq(stake_ai.key(), &exp_stake_pda) {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::from_account_info(clock_ai)?;
    let now = clock.unix_timestamp;
    update_farm_acc(&mut farm, now);

    let mut stake_data = stake_read(&stake_ai.try_borrow_data()?)?;
    if stake_data.amount < amount {
        return Err(custom(ERR_INSUFFICIENT_STAKE));
    }

    settle_rewards(
        farm_ai,
        &farm,
        &stake_data,
        user_rw,
        reward_vault,
        reward_mint_ai,
        tok_rw,
    )?;

    stake_data.reward_debt = debt_for_amount(stake_data.amount, farm.acc_reward_per_share);

    let dec_lp = Mint::from_account_info(lp_mint_ai)?.decimals();
    let bump = [farm.farm_bump];
    let vseeds = farm_signer_seeds3(&farm.lp_mint, bump.as_slice());
    let vsig = Signer::from(&vseeds[..]);
    TransferChecked {
        source: stake_vault,
        mint: lp_mint_ai,
        destination: user_lp,
        authority: farm_ai,
        amount,
        decimals: dec_lp,
        program_id: None,
    }
    .invoke_signed(&[vsig])?;

    farm.total_staked = farm.total_staked.saturating_sub(amount);
    stake_data.amount = stake_data.amount.saturating_sub(amount);
    stake_data.reward_debt = debt_for_amount(stake_data.amount, farm.acc_reward_per_share);

    {
        let mut s = stake_ai.try_borrow_mut_data()?;
        stake_write(&mut s, stake_data.amount, stake_data.reward_debt);
    }
    {
        let mut fd = farm_ai.try_borrow_mut_data()?;
        farm_write_from_state(&mut fd, &farm);
    }
    Ok(())
}

/// 7: `farm`, `user_stake`, `user`, `user_reward_ata`, `reward_vault`, `reward_mint`, `token_rw`, `clock`
fn process_claim(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [farm_ai, stake_ai, user, user_rw, reward_vault, reward_mint_ai, _tok_rw, clock_ai] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !user.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    verify_clock(clock_ai)?;

    let mut farm = farm_read(&farm_ai.try_borrow_data()?)?;
    if !pubkey_eq(farm_ai.key(), &farm_pda(&farm.lp_mint, program_id).0) {
        return Err(ProgramError::InvalidSeeds);
    }
    if !pubkey_eq(reward_vault.key(), &farm.reward_vault)
        || !pubkey_eq(reward_mint_ai.key(), &farm.reward_mint)
    {
        return Err(custom(ERR_VAULT_MISMATCH));
    }

    let (exp_stake_pda, _) = stake_pda(farm_ai.key(), user.key(), program_id);
    if !pubkey_eq(stake_ai.key(), &exp_stake_pda) {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::from_account_info(clock_ai)?;
    let now = clock.unix_timestamp;
    update_farm_acc(&mut farm, now);

    let mut stake_data = stake_read(&stake_ai.try_borrow_data()?)?;
    let pending = pending_rewards(
        stake_data.amount,
        farm.acc_reward_per_share,
        stake_data.reward_debt,
    );
    if pending == 0 {
        let mut fd = farm_ai.try_borrow_mut_data()?;
        farm_write_from_state(&mut fd, &farm);
        return Ok(());
    }
    if pending > u64::MAX as u128 {
        return Err(custom(ERR_MATH));
    }
    let dec = Mint::from_account_info(reward_mint_ai)?.decimals();
    let bump = [farm.farm_bump];
    let vseeds = farm_signer_seeds3(&farm.lp_mint, bump.as_slice());
    let vsig = Signer::from(&vseeds[..]);
    TransferChecked {
        source: reward_vault,
        mint: reward_mint_ai,
        destination: user_rw,
        authority: farm_ai,
        amount: pending as u64,
        decimals: dec,
        program_id: None,
    }
    .invoke_signed(&[vsig])?;

    stake_data.reward_debt = debt_for_amount(stake_data.amount, farm.acc_reward_per_share);
    {
        let mut s = stake_ai.try_borrow_mut_data()?;
        stake_write(&mut s, stake_data.amount, stake_data.reward_debt);
    }
    {
        let mut fd = farm_ai.try_borrow_mut_data()?;
        farm_write_from_state(&mut fd, &farm);
    }
    Ok(())
}
