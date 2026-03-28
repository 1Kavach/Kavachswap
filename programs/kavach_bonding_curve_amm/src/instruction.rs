//! Instruction dispatcher. 0=InitConfig, 1=CreatePool, 2=DepositTokens, 3=Buy, 4=Sell, 5=SetPaused, 6=UpdateClmmProgram.

use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::invoke,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    system_instruction,
    sysvar::Sysvar,
};

use spl_token::state::Mint;

use crate::error::BcError;
use crate::events;
use crate::math;
use crate::state::{BondingCurveConfig, BondingCurvePool};

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const DEFAULT_VIRTUAL_SOL: u64 = 30 * LAMPORTS_PER_SOL;
const GRADUATION_SOL: u64 = 69 * LAMPORTS_PER_SOL;
const SNIPE_BLOCKS: u64 = 5;
const MAX_SOL_PER_SNIPE_BUY: u64 = 500_000_000; // 0.5 SOL

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data
        .first()
        .copied()
        .ok_or(ProgramError::InvalidInstructionData)?;
    let data = instruction_data.get(1..).unwrap_or_default();

    match discriminator {
        0 => {
            let args: InitConfigArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            init_config(program_id, accounts, args)
        }
        1 => {
            let args: CreatePoolArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            create_pool(program_id, accounts, args)
        }
        2 => {
            let args: DepositTokensArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            deposit_tokens(program_id, accounts, args)
        }
        3 => {
            let args: BuyArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            buy(program_id, accounts, args)
        }
        4 => {
            let args: SellArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            sell(program_id, accounts, args)
        }
        5 => {
            let args: SetPausedArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            set_paused(program_id, accounts, args)
        }
        6 => {
            let args: UpdateClmmArgs =
                BorshDeserialize::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
            update_clmm_program(program_id, accounts, args)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[derive(BorshDeserialize)]
struct InitConfigArgs {
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
}

#[derive(BorshDeserialize)]
struct CreatePoolArgs {
    virtual_sol_reserves: u64,
    graduation_threshold: u64,
    creator_fee_bps_override: u64,
    is_token_2022: bool,
}

#[derive(BorshDeserialize)]
struct DepositTokensArgs {
    amount: u64,
}

#[derive(BorshDeserialize)]
struct BuyArgs {
    sol_in: u64,
    min_tokens_out: u64,
}

#[derive(BorshDeserialize)]
struct SellArgs {
    token_in: u64,
    min_sol_out: u64,
}

#[derive(BorshDeserialize)]
struct SetPausedArgs {
    paused: bool,
}

#[derive(BorshDeserialize)]
struct UpdateClmmArgs {
    new_clmm_program: Pubkey,
}

// ─────────────────────────────────────────────────────────────────────────────
// InitConfig: config (PDA), admin, protocol_treasury, clmm_program, system_program, rent
// ─────────────────────────────────────────────────────────────────────────────
fn init_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: InitConfigArgs,
) -> ProgramResult {
    if args.protocol_fee_bps + args.creator_fee_bps > 500 {
        return Err(BcError::InvalidFeeBps.into());
    }

    let [config, admin, protocol_treasury, clmm_program, system_program, rent_sysvar] =
        match accounts {
            [a, b, c, d, e, f] => [a, b, c, d, e, f],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    let (config_pda, bump) = Pubkey::find_program_address(&[b"bc_config"], program_id);
    if config.key != &config_pda {
        return Err(BcError::InvalidConfigPda.into());
    }
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let rent = solana_program::rent::Rent::from_account_info(rent_sysvar)?;
    let rent_lamports = rent.minimum_balance(BondingCurveConfig::LEN);

    invoke(
        &system_instruction::create_account(
            admin.key,
            config.key,
            rent_lamports,
            BondingCurveConfig::LEN as u64,
            program_id,
        ),
        &[admin.clone(), config.clone(), system_program.clone()],
    )?;

    let cfg = BondingCurveConfig {
        admin: *admin.key,
        protocol_treasury: *protocol_treasury.key,
        clmm_program: *clmm_program.key,
        protocol_fee_bps: args.protocol_fee_bps,
        creator_fee_bps: args.creator_fee_bps,
        paused: false,
        bump,
    };
    let bytes = borsh::BorshSerialize::try_to_vec(&cfg).map_err(|_| ProgramError::InvalidAccountData)?;
    config.data.borrow_mut()[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// CreatePool: config, mint, pool (PDA), token_vault (PDA), sol_vault (PDA), creator, system_program, token_program, rent, clock
// ─────────────────────────────────────────────────────────────────────────────
fn create_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: CreatePoolArgs,
) -> ProgramResult {
    let [config, mint, pool, token_vault, sol_vault, creator, system_program, token_program, rent_sysvar, clock_account] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j] => [a, b, c, d, e, f, g, h, i, j],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !creator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let config_data = config.data.borrow();
    let cfg: BondingCurveConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if cfg.paused {
        return Err(BcError::CurvePaused.into());
    }
    drop(config_data);

    let (pool_pda, pool_bump) = Pubkey::find_program_address(&[b"pool", mint.key.as_ref()], program_id);
    if pool.key != &pool_pda {
        return Err(BcError::InvalidPoolPda.into());
    }
    let (sol_vault_pda, sol_vault_bump) =
        Pubkey::find_program_address(&[b"sol_vault", mint.key.as_ref()], program_id);
    if sol_vault.key != &sol_vault_pda {
        return Err(BcError::InvalidSolVaultPda.into());
    }

    let virtual_sol = if args.virtual_sol_reserves == 0 {
        DEFAULT_VIRTUAL_SOL
    } else {
        args.virtual_sol_reserves
    };
    let graduation_threshold = if args.graduation_threshold == 0 {
        GRADUATION_SOL
    } else {
        args.graduation_threshold
    };

    let rent = solana_program::rent::Rent::from_account_info(rent_sysvar)?;
    let pool_rent = rent.minimum_balance(BondingCurvePool::LEN);
    let account_rent = rent.minimum_balance(spl_token::state::Account::get_packed_len());

    // Create pool account
    invoke(
        &system_instruction::create_account(
            creator.key,
            pool.key,
            pool_rent,
            BondingCurvePool::LEN as u64,
            program_id,
        ),
        &[creator.clone(), pool.clone(), system_program.clone()],
    )?;

    // Create token_vault (ATA-style PDA: owned by token program, authority = pool)
    invoke(
        &system_instruction::create_account(
            creator.key,
            token_vault.key,
            account_rent,
            spl_token::state::Account::get_packed_len() as u64,
            token_program.key,
        ),
        &[creator.clone(), token_vault.clone(), system_program.clone()],
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            token_vault.key,
            mint.key,
            pool.key,
        )?,
        &[token_vault.clone(), mint.clone(), pool.clone(), token_program.clone()],
    )?;

    // Create sol_vault (0 bytes, holds lamports; min balance 0)
    let sol_rent = rent.minimum_balance(0);
    invoke(
        &system_instruction::create_account(
            creator.key,
            sol_vault.key,
            sol_rent,
            0,
            program_id,
        ),
        &[creator.clone(), sol_vault.clone(), system_program.clone()],
    )?;

    let clock = Clock::from_account_info(clock_account)?;

    let pool_state = BondingCurvePool {
        config: *config.key,
        mint: *mint.key,
        creator: *creator.key,
        token_vault: *token_vault.key,
        sol_vault: *sol_vault.key,
        virtual_sol_reserves: virtual_sol,
        real_sol_reserves: 0,
        token_reserves: 0,
        graduation_threshold,
        graduated: false,
        graduation_slot: 0,
        creator_fee_bps_override: args.creator_fee_bps_override,
        is_token_2022: args.is_token_2022,
        created_slot: clock.slot,
        total_buys: 0,
        total_sells: 0,
        total_volume_sol: 0,
        bump: pool_bump,
        sol_vault_bump,
    };
    let bytes = borsh::BorshSerialize::try_to_vec(&pool_state).map_err(|_| ProgramError::InvalidAccountData)?;
    pool.data.borrow_mut()[..bytes.len()].copy_from_slice(&bytes);

    events::emit_bonding_curve_created(
        *pool.key,
        *creator.key,
        *mint.key,
        virtual_sol,
        0,
        graduation_threshold,
        clock.slot,
        clock.unix_timestamp,
    )?;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// DepositTokens: pool, mint, token_vault, creator_token_account, creator, token_program
// ─────────────────────────────────────────────────────────────────────────────
fn deposit_tokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: DepositTokensArgs,
) -> ProgramResult {
    if args.amount == 0 {
        return Err(BcError::ZeroAmount.into());
    }

    let [pool, mint, token_vault, creator_token_account, creator, token_program] = match accounts {
        [a, b, c, d, e, f] => [a, b, c, d, e, f],
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    let (pool_pda, _) = Pubkey::find_program_address(&[b"pool", mint.key.as_ref()], program_id);
    if pool.key != &pool_pda {
        return Err(BcError::InvalidPoolPda.into());
    }
    if !creator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: BondingCurvePool =
        BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if pool_state.graduated {
        return Err(BcError::AlreadyGraduated.into());
    }
    if pool_state.creator != *creator.key {
        return Err(BcError::Unauthorized.into());
    }
    if pool_state.token_vault != *token_vault.key {
        return Err(ProgramError::InvalidAccountData);
    }

    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            creator_token_account.key,
            token_vault.key,
            creator.key,
            &[],
            args.amount,
        )?,
        &[
            creator_token_account.clone(),
            token_vault.clone(),
            creator.clone(),
            token_program.clone(),
        ],
    )?;

    pool_state.token_reserves = pool_state
        .token_reserves
        .checked_add(args.amount)
        .ok_or(BcError::MathOverflow)?;
    let bytes = borsh::BorshSerialize::try_to_vec(&pool_state).map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Buy: pool, config, mint, token_vault, sol_vault, user_token_account, user, protocol_treasury, creator, system_program, token_program, clock
// ─────────────────────────────────────────────────────────────────────────────
fn buy(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: BuyArgs,
) -> ProgramResult {
    if args.sol_in == 0 {
        return Err(BcError::ZeroAmount.into());
    }

    let [pool, config, mint, token_vault, sol_vault, user_token_account, user, protocol_treasury, creator, system_program, token_program, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l] => [a, b, c, d, e, f, g, h, i, j, k, l],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let config_data = config.data.borrow();
    let cfg: BondingCurveConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if cfg.paused {
        return Err(BcError::CurvePaused.into());
    }
    let (protocol_fee_bps, creator_fee_bps_cfg, clmm_program) =
        (cfg.protocol_fee_bps, cfg.creator_fee_bps, cfg.clmm_program);
    drop(config_data);

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: BondingCurvePool =
        BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if pool_state.graduated {
        return Err(BcError::AlreadyGraduated.into());
    }
    if pool_state.config != *config.key {
        return Err(ProgramError::InvalidAccountData);
    }

    let clock = Clock::from_account_info(clock)?;
    if clock.slot.saturating_sub(pool_state.created_slot) < SNIPE_BLOCKS {
        if args.sol_in > MAX_SOL_PER_SNIPE_BUY {
            return Err(BcError::AntiSnipeTooLarge.into());
        }
    }

    let creator_bps = if pool_state.creator_fee_bps_override > 0 {
        pool_state.creator_fee_bps_override
    } else {
        creator_fee_bps_cfg
    };
    let (after_protocol, protocol_fee) = math::apply_fee(args.sol_in, protocol_fee_bps);
    let (sol_net, creator_fee) = math::apply_fee(after_protocol, creator_bps);

    let tokens_out = math::tokens_out(
        pool_state.virtual_sol_reserves,
        pool_state.real_sol_reserves,
        pool_state.token_reserves,
        sol_net,
    )?;
    if tokens_out < args.min_tokens_out {
        return Err(BcError::SlippageExceeded.into());
    }
    if tokens_out > pool_state.token_reserves {
        return Err(BcError::InsufficientTokenReserves.into());
    }

    // User -> sol_vault (net SOL)
    invoke(
        &system_instruction::transfer(user.key, sol_vault.key, sol_net),
        &[user.clone(), sol_vault.clone(), system_program.clone()],
    )?;
    if protocol_fee > 0 {
        invoke(
            &system_instruction::transfer(user.key, protocol_treasury.key, protocol_fee),
            &[user.clone(), protocol_treasury.clone(), system_program.clone()],
        )?;
    }
    if creator_fee > 0 {
        invoke(
            &system_instruction::transfer(user.key, creator.key, creator_fee),
            &[user.clone(), creator.clone(), system_program.clone()],
        )?;
    }

    let mint_data = mint.data.borrow();
    let mint_state = Mint::unpack(&mint_data)?;
    let decimals = mint_state.decimals;
    drop(mint_data);

    let pool_seeds = pool_state.pool_signer_seeds();
    let signers: &[&[&[u8]]] = &[&pool_seeds[..]];

    invoke_signed(
        &spl_token::instruction::transfer_checked(
            token_program.key,
            token_vault.key,
            mint.key,
            user_token_account.key,
            pool.key,
            &[],
            tokens_out,
            decimals,
        )?,
        &[
            token_vault.clone(),
            user_token_account.clone(),
            pool.clone(),
            token_program.clone(),
        ],
        signers,
    )?;

    pool_state.real_sol_reserves = pool_state
        .real_sol_reserves
        .checked_add(sol_net)
        .ok_or(BcError::MathOverflow)?;
    pool_state.token_reserves = pool_state
        .token_reserves
        .checked_sub(tokens_out)
        .ok_or(BcError::MathOverflow)?;
    pool_state.total_buys = pool_state.total_buys.saturating_add(1);
    pool_state.total_volume_sol = pool_state.total_volume_sol.saturating_add(args.sol_in);

    let price = math::spot_price(
        pool_state.virtual_sol_reserves,
        pool_state.real_sol_reserves,
        pool_state.token_reserves,
    );
    events::emit_buy(
        *pool.key,
        *user.key,
        args.sol_in,
        tokens_out,
        protocol_fee,
        creator_fee,
        pool_state.virtual_sol_reserves,
        pool_state.real_sol_reserves,
        pool_state.token_reserves,
        price,
        clock.slot,
    )?;

    if pool_state.real_sol_reserves >= pool_state.graduation_threshold {
        pool_state.graduated = true;
        pool_state.graduation_slot = clock.slot;
        events::emit_graduation(
            *pool.key,
            pool_state.mint,
            pool_state.real_sol_reserves,
            pool_state.token_reserves,
            clmm_program,
            clock.slot,
        )?;
    }

    let bytes = borsh::BorshSerialize::try_to_vec(&pool_state).map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Sell: pool, config, mint, token_vault, sol_vault, user_token_account, user, protocol_treasury, creator, system_program, token_program, clock
// ─────────────────────────────────────────────────────────────────────────────
fn sell(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: SellArgs,
) -> ProgramResult {
    if args.token_in == 0 {
        return Err(BcError::ZeroAmount.into());
    }

    let [pool, config, mint, token_vault, sol_vault, user_token_account, user, protocol_treasury, creator, system_program, token_program, clock] =
        match accounts {
            [a, b, c, d, e, f, g, h, i, j, k, l] => [a, b, c, d, e, f, g, h, i, j, k, l],
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let config_data = config.data.borrow();
    let cfg: BondingCurveConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if cfg.paused {
        return Err(BcError::CurvePaused.into());
    }
    let (protocol_fee_bps, creator_fee_bps_cfg) = (cfg.protocol_fee_bps, cfg.creator_fee_bps);
    drop(config_data);

    let mut pool_data = pool.data.borrow_mut();
    let mut pool_state: BondingCurvePool =
        BorshDeserialize::try_from_slice(&pool_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if pool_state.graduated {
        return Err(BcError::AlreadyGraduated.into());
    }

    let creator_bps = if pool_state.creator_fee_bps_override > 0 {
        pool_state.creator_fee_bps_override
    } else {
        creator_fee_bps_cfg
    };

    let sol_gross = math::sol_out(
        pool_state.virtual_sol_reserves,
        pool_state.real_sol_reserves,
        pool_state.token_reserves,
        args.token_in,
    )?;
    if pool_state.real_sol_reserves < sol_gross {
        return Err(BcError::InsufficientSolReserves.into());
    }

    let (after_protocol, protocol_fee) = math::apply_fee(sol_gross, protocol_fee_bps);
    let (sol_net, creator_fee) = math::apply_fee(after_protocol, creator_bps);
    if sol_net < args.min_sol_out {
        return Err(BcError::SlippageExceeded.into());
    }

    let mint_data = mint.data.borrow();
    let mint_state = Mint::unpack(&mint_data)?;
    let decimals = mint_state.decimals;
    drop(mint_data);

    invoke(
        &spl_token::instruction::transfer_checked(
            token_program.key,
            user_token_account.key,
            mint.key,
            token_vault.key,
            user.key,
            &[],
            args.token_in,
            decimals,
        )?,
        &[
            user_token_account.clone(),
            token_vault.clone(),
            user.clone(),
            token_program.clone(),
        ],
    )?;

    invoke(
        &system_instruction::transfer(sol_vault.key, user.key, sol_net),
        &[sol_vault.clone(), user.clone(), system_program.clone()],
    )?;
    if protocol_fee > 0 {
        invoke(
            &system_instruction::transfer(sol_vault.key, protocol_treasury.key, protocol_fee),
            &[sol_vault.clone(), protocol_treasury.clone(), system_program.clone()],
        )?;
    }
    if creator_fee > 0 {
        invoke(
            &system_instruction::transfer(sol_vault.key, creator.key, creator_fee),
            &[sol_vault.clone(), creator.clone(), system_program.clone()],
        )?;
    }

    pool_state.real_sol_reserves = pool_state
        .real_sol_reserves
        .checked_sub(sol_gross)
        .ok_or(BcError::MathOverflow)?;
    pool_state.token_reserves = pool_state
        .token_reserves
        .checked_add(args.token_in)
        .ok_or(BcError::MathOverflow)?;
    pool_state.total_sells = pool_state.total_sells.saturating_add(1);
    pool_state.total_volume_sol = pool_state.total_volume_sol.saturating_add(sol_gross);

    let clock_val = Clock::from_account_info(clock)?;
    events::emit_sell(
        *pool.key,
        *user.key,
        args.token_in,
        sol_net,
        protocol_fee,
        creator_fee,
        pool_state.virtual_sol_reserves,
        pool_state.real_sol_reserves,
        pool_state.token_reserves,
        clock_val.slot,
    )?;

    let bytes = borsh::BorshSerialize::try_to_vec(&pool_state).map_err(|_| ProgramError::InvalidAccountData)?;
    pool_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// SetPaused: config (PDA), admin (signer)
// ─────────────────────────────────────────────────────────────────────────────
fn set_paused(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: SetPausedArgs,
) -> ProgramResult {
    let [config, admin] = match accounts {
        [a, b] => [a, b],
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    let (config_pda, _) = Pubkey::find_program_address(&[b"bc_config"], program_id);
    if config.key != &config_pda {
        return Err(BcError::InvalidConfigPda.into());
    }
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut config_data = config.data.borrow_mut();
    let mut cfg: BondingCurveConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if cfg.admin != *admin.key {
        return Err(BcError::Unauthorized.into());
    }
    cfg.paused = args.paused;
    let bytes = borsh::BorshSerialize::try_to_vec(&cfg).map_err(|_| ProgramError::InvalidAccountData)?;
    config_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// UpdateClmmProgram: config (PDA), admin (signer)
// ─────────────────────────────────────────────────────────────────────────────
fn update_clmm_program(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: UpdateClmmArgs,
) -> ProgramResult {
    let [config, admin] = match accounts {
        [a, b] => [a, b],
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    let (config_pda, _) = Pubkey::find_program_address(&[b"bc_config"], program_id);
    if config.key != &config_pda {
        return Err(BcError::InvalidConfigPda.into());
    }
    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut config_data = config.data.borrow_mut();
    let mut cfg: BondingCurveConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| BcError::ConfigNotInitialized)?;
    if cfg.admin != *admin.key {
        return Err(BcError::Unauthorized.into());
    }
    cfg.clmm_program = args.new_clmm_program;
    let bytes = borsh::BorshSerialize::try_to_vec(&cfg).map_err(|_| ProgramError::InvalidAccountData)?;
    config_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}