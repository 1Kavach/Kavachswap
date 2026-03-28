//! Router instructions: 0 = InitConfig, 1 = RouteAndSwap, 2 = UpdateConfig, 3 = RouteAndSwapMultiHop.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    log::sol_log_data,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

use crate::error::RouterError;
use crate::state::RouterConfig;

/// Discriminator: 0 = InitConfig, 1 = RouteAndSwap, 2 = UpdateConfig, 3 = RouteAndSwapMultiHop
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let discriminator = instruction_data.first().copied().ok_or(ProgramError::InvalidInstructionData)?;
    let data = instruction_data.get(1..).unwrap_or_default();

    match discriminator {
        0 => {
            let args: InitConfigArgs = BorshDeserialize::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            init_config(program_id, accounts, args)
        }
        1 => {
            let args: RouteAndSwapArgs = BorshDeserialize::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            route_and_swap(program_id, accounts, args)
        }
        2 => {
            let amm_program_ids: [Pubkey; 4] = BorshDeserialize::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            update_config(program_id, accounts, amm_program_ids)
        }
        3 => {
            let args: RouteAndSwapMultiHopArgs = BorshDeserialize::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            route_and_swap_multihop(program_id, accounts, args)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[derive(BorshDeserialize)]
struct InitConfigArgs {
    amm_program_ids: [Pubkey; 4],
    authority: Pubkey,
}

#[derive(BorshDeserialize)]
struct RouteAndSwapArgs {
    amount_in: u64,
    minimum_amount_out: u64,
    amm_id: u8,
    a_to_b: bool,
}

#[derive(BorshDeserialize)]
struct RouteAndSwapMultiHopArgs {
    amount_in: u64,                  // hop 1 input
    amount_in_2: u64,                // hop 2 input (= hop 1 output, client-computed)
    minimum_amount_out: u64,         // final output min (enforced on hop 2)
    minimum_amount_out_hop1: u64,    // min output from hop 1 (slippage protection on first leg)
    amm_id_1: u8,
    amm_id_2: u8,
    a_to_b_1: bool,
    a_to_b_2: bool,
}

/// Event for indexer: discriminator 6. Emitted via sol_log_data after successful RouteAndSwap.
#[derive(BorshSerialize)]
struct RouterSwapEvent {
    user: [u8; 32],
    amm_id: u8,
    amount_in: u64,
    minimum_amount_out: u64,
    pool: [u8; 32],
    timestamp: i64,
}

const ROUTER_SWAP_EVENT_DISCRIMINATOR: u8 = 6;

/// InitConfig accounts: config (PDA), payer, system_program, rent_sysvar
fn init_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: InitConfigArgs,
) -> ProgramResult {
    let [config, payer, system_program, rent_sysvar] = match accounts {
        [a, b, c, d] => [a, b, c, d],
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    let (config_pda, bump) = Pubkey::find_program_address(&[b"config"], program_id);
    if config.key != &config_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !solana_program::sysvar::rent::check_id(rent_sysvar.key) {
        return Err(ProgramError::InvalidAccountData);
    }
    if system_program.key != &solana_program::system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let rent = solana_program::rent::Rent::from_account_info(rent_sysvar)?;
    let rent_lamports = rent.minimum_balance(RouterConfig::LEN);

    let signer_seeds: &[&[u8]] = &[b"config", &[bump]];
    solana_program::program::invoke_signed(
        &solana_program::system_instruction::create_account(
            payer.key,
            config.key,
            rent_lamports,
            RouterConfig::LEN as u64,
            program_id,
        ),
        &[payer.clone(), config.clone(), system_program.clone()],
        &[signer_seeds],
    )?;

    let cfg = RouterConfig {
        is_initialized: true,
        authority: args.authority,
        amm_program_ids: args.amm_program_ids,
    };
    let bytes = borsh::BorshSerialize::try_to_vec(&cfg).map_err(|_| ProgramError::InvalidAccountData)?;
    config.data.borrow_mut()[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}

/// RouteAndSwap accounts:
/// - **Slot 1 (Stable):** 15 accounts — config, user, amm_program, pool, vault_in, vault_out,
///   user_token_in, user_token_out, mint_a, mint_b, token_program_a, token_program_b,
///   protocol_fee_ata, creator_fee_ata, clock.
/// - **Other slots (e.g. Core slot 3):** 13 accounts — same without the two fee ATAs.
fn route_and_swap(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: RouteAndSwapArgs,
) -> ProgramResult {
    if args.amm_id >= 4 {
        return Err(RouterError::InvalidAmmId.into());
    }

    let amm_data = {
        let mut d = vec![1u8];
        d.extend(
            BorshSerialize::try_to_vec(&(
                args.amount_in,
                args.minimum_amount_out,
                args.a_to_b,
            ))
            .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        d
    };

    if args.amm_id == 1 {
        let [config, user, amm_program, pool, vault_in, vault_out, user_token_in, user_token_out, mint_a, mint_b, token_program_a, token_program_b, protocol_fee_ata, creator_fee_ata, clock] =
            match accounts {
                [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o] => [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o],
                _ => return Err(ProgramError::NotEnoughAccountKeys),
            };

        if !user.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let config_data = config.data.borrow();
        let router_config: RouterConfig =
            BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| RouterError::ConfigNotInitialized)?;
        if !router_config.is_initialized {
            return Err(RouterError::ConfigNotInitialized.into());
        }
        if amm_program.key != &router_config.amm_program_ids[args.amm_id as usize] {
            return Err(RouterError::ConfigMismatch.into());
        }
        if !solana_program::sysvar::clock::check_id(clock.key) {
            return Err(ProgramError::InvalidAccountData);
        }
        drop(config_data);

        invoke_amm_swap(
            amm_program,
            pool,
            vault_in,
            vault_out,
            user_token_in,
            user_token_out,
            user,
            mint_a,
            mint_b,
            token_program_a,
            token_program_b,
            clock,
            args.amm_id,
            &amm_data,
            Some(protocol_fee_ata),
            Some(creator_fee_ata),
        )?;
    } else {
        let [config, user, amm_program, pool, vault_in, vault_out, user_token_in, user_token_out, mint_a, mint_b, token_program_a, token_program_b, clock] =
            match accounts {
                [a, b, c, d, e, f, g, h, i, j, k, l, m] => [a, b, c, d, e, f, g, h, i, j, k, l, m],
                _ => return Err(ProgramError::NotEnoughAccountKeys),
            };

        if !user.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let config_data = config.data.borrow();
        let router_config: RouterConfig =
            BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| RouterError::ConfigNotInitialized)?;
        if !router_config.is_initialized {
            return Err(RouterError::ConfigNotInitialized.into());
        }
        if amm_program.key != &router_config.amm_program_ids[args.amm_id as usize] {
            return Err(RouterError::ConfigMismatch.into());
        }
        if !solana_program::sysvar::clock::check_id(clock.key) {
            return Err(ProgramError::InvalidAccountData);
        }
        drop(config_data);

        invoke_amm_swap(
            amm_program,
            pool,
            vault_in,
            vault_out,
            user_token_in,
            user_token_out,
            user,
            mint_a,
            mint_b,
            token_program_a,
            token_program_b,
            clock,
            args.amm_id,
            &amm_data,
            None,
            None,
        )?;
    }

    let clock = accounts.last().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let user = accounts.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let pool = accounts.get(3).ok_or(ProgramError::NotEnoughAccountKeys)?;

    let clock_sysvar = solana_program::sysvar::clock::Clock::from_account_info(clock)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let router_evt = RouterSwapEvent {
        user: user.key.to_bytes(),
        amm_id: args.amm_id,
        amount_in: args.amount_in,
        minimum_amount_out: args.minimum_amount_out,
        pool: pool.key.to_bytes(),
        timestamp: clock_sysvar.unix_timestamp,
    };
    let mut evt_data = vec![ROUTER_SWAP_EVENT_DISCRIMINATOR];
    evt_data.extend(
        BorshSerialize::try_to_vec(&router_evt).map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    sol_log_data(&[&evt_data]);

    msg!(
        "SwapRouter:user={},amm_id={},amount_in={},min_out={}",
        user.key,
        args.amm_id,
        args.amount_in,
        args.minimum_amount_out
    );

    Ok(())
}

/// RouteAndSwapMultiHop accounts — **length depends on Stable (slot 1) usage**:
///
/// **Base (20)** when **neither** hop is Stable:  
/// `config`, `user`, `amm_program_1`, `pool_1`, `vault_1_in`, `vault_1_out`, `mint_1_a`, `mint_1_b`,  
/// `amm_program_2`, `pool_2`, `vault_2_in`, `vault_2_out`, `mint_2_a`, `mint_2_b`,  
/// `user_token_in`, `user_token_intermediate`, `user_token_out`, `token_program_a`, `token_program_b`, `clock`.
///
/// **+2** after `mint_1_a`, `mint_1_b` when **hop 1** is Kavach Stable (`amm_id_1 == 1`):  
/// `protocol_fee_ata_1`, `creator_fee_ata_1` (output-mint fee recipients for that pool).
///
/// **+2** after `mint_2_a`, `mint_2_b` when **hop 2** is Stable (`amm_id_2 == 1`):  
/// `protocol_fee_ata_2`, `creator_fee_ata_2`.
///
/// Examples: Core→Core = 20; Stable→Core = 22; Core→Stable = 22; Stable→Stable = 24.
///
/// Hop 1: `user_token_in` → `user_token_intermediate`. Hop 2: intermediate → `user_token_out`.  
/// Client must pass `amount_in_2` = expected hop 1 output (from quote).
fn route_and_swap_multihop(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: RouteAndSwapMultiHopArgs,
) -> ProgramResult {
    if args.amm_id_1 >= 4 || args.amm_id_2 >= 4 {
        return Err(RouterError::InvalidAmmId.into());
    }

    let fee1: usize = if args.amm_id_1 == 1 { 2 } else { 0 };
    let fee2: usize = if args.amm_id_2 == 1 { 2 } else { 0 };
    let expected_len = 20 + fee1 + fee2;
    if accounts.len() != expected_len {
        return Err(RouterError::MultihopAccountLayout.into());
    }

    let mut i: usize = 0;
    let config = &accounts[i];
    i += 1;
    let user = &accounts[i];
    i += 1;
    let amm_program_1 = &accounts[i];
    i += 1;
    let pool_1 = &accounts[i];
    i += 1;
    let vault_1_in = &accounts[i];
    i += 1;
    let vault_1_out = &accounts[i];
    i += 1;
    let mint_1_a = &accounts[i];
    i += 1;
    let mint_1_b = &accounts[i];
    i += 1;
    let (protocol_fee_1, creator_fee_1): (Option<&AccountInfo>, Option<&AccountInfo>) =
        if args.amm_id_1 == 1 {
            let p = &accounts[i];
            i += 1;
            let c = &accounts[i];
            i += 1;
            (Some(p), Some(c))
        } else {
            (None, None)
        };
    let amm_program_2 = &accounts[i];
    i += 1;
    let pool_2 = &accounts[i];
    i += 1;
    let vault_2_in = &accounts[i];
    i += 1;
    let vault_2_out = &accounts[i];
    i += 1;
    let mint_2_a = &accounts[i];
    i += 1;
    let mint_2_b = &accounts[i];
    i += 1;
    let (protocol_fee_2, creator_fee_2): (Option<&AccountInfo>, Option<&AccountInfo>) =
        if args.amm_id_2 == 1 {
            let p = &accounts[i];
            i += 1;
            let c = &accounts[i];
            i += 1;
            (Some(p), Some(c))
        } else {
            (None, None)
        };
    let user_token_in = &accounts[i];
    i += 1;
    let user_token_intermediate = &accounts[i];
    i += 1;
    let user_token_out = &accounts[i];
    i += 1;
    let token_program_a = &accounts[i];
    i += 1;
    let token_program_b = &accounts[i];
    i += 1;
    let clock = &accounts[i];

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let config_data = config.data.borrow();
    let router_config: RouterConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| RouterError::ConfigNotInitialized)?;
    if !router_config.is_initialized {
        return Err(RouterError::ConfigNotInitialized.into());
    }
    if amm_program_1.key != &router_config.amm_program_ids[args.amm_id_1 as usize]
        || amm_program_2.key != &router_config.amm_program_ids[args.amm_id_2 as usize]
    {
        return Err(RouterError::ConfigMismatch.into());
    }
    if !solana_program::sysvar::clock::check_id(clock.key) {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(config_data);

    // Hop 1: user_token_in -> user_token_intermediate
    let amm_data_1 = {
        let mut d = vec![1u8];
        d.extend(
            BorshSerialize::try_to_vec(&(args.amount_in, args.minimum_amount_out_hop1, args.a_to_b_1))
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        d
    };

    invoke_amm_swap(
        amm_program_1,
        pool_1,
        vault_1_in,
        vault_1_out,
        user_token_in,
        user_token_intermediate,
        user,
        mint_1_a,
        mint_1_b,
        token_program_a,
        token_program_b,
        clock,
        args.amm_id_1,
        &amm_data_1,
        protocol_fee_1,
        creator_fee_1,
    )?;

    // Hop 2: user_token_intermediate -> user_token_out
    let amm_data_2 = {
        let mut d = vec![1u8];
        d.extend(
            BorshSerialize::try_to_vec(&(args.amount_in_2, args.minimum_amount_out, args.a_to_b_2))
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        d
    };

    invoke_amm_swap(
        amm_program_2,
        pool_2,
        vault_2_in,
        vault_2_out,
        user_token_intermediate,
        user_token_out,
        user,
        mint_2_a,
        mint_2_b,
        token_program_a,
        token_program_b,
        clock,
        args.amm_id_2,
        &amm_data_2,
        protocol_fee_2,
        creator_fee_2,
    )?;

    msg!(
        "SwapRouterMultiHop:user={},amm_ids=[{},{}],amount_in={},min_out={}",
        user.key,
        args.amm_id_1,
        args.amm_id_2,
        args.amount_in,
        args.minimum_amount_out
    );

    Ok(())
}

fn invoke_amm_swap<'a>(
    amm_program: &AccountInfo<'a>,
    pool: &AccountInfo<'a>,
    vault_in: &AccountInfo<'a>,
    vault_out: &AccountInfo<'a>,
    user_token_in: &AccountInfo<'a>,
    user_token_out: &AccountInfo<'a>,
    user: &AccountInfo<'a>,
    mint_a: &AccountInfo<'a>,
    mint_b: &AccountInfo<'a>,
    token_program_a: &AccountInfo<'a>,
    token_program_b: &AccountInfo<'a>,
    clock: &AccountInfo<'a>,
    amm_id: u8,
    amm_data: &[u8],
    stable_protocol_fee_ata: Option<&AccountInfo<'a>>,
    stable_creator_fee_ata: Option<&AccountInfo<'a>>,
) -> ProgramResult {
    // Slot 3 = Core: 11 accounts (transfer_checked + mints).
    if amm_id == 3 {
        let ix = Instruction {
            program_id: *amm_program.key,
            accounts: vec![
                AccountMeta::new(*pool.key, false),
                AccountMeta::new(*vault_in.key, true),
                AccountMeta::new(*vault_out.key, true),
                AccountMeta::new(*user_token_in.key, true),
                AccountMeta::new(*user_token_out.key, true),
                AccountMeta::new_readonly(*user.key, true),
                AccountMeta::new_readonly(*mint_a.key, false),
                AccountMeta::new_readonly(*mint_b.key, false),
                AccountMeta::new_readonly(*token_program_a.key, false),
                AccountMeta::new_readonly(*token_program_b.key, false),
                AccountMeta::new_readonly(*clock.key, false),
            ],
            data: amm_data.to_vec(),
        };
        invoke(
            &ix,
            &[
                pool.clone(),
                vault_in.clone(),
                vault_out.clone(),
                user_token_in.clone(),
                user_token_out.clone(),
                user.clone(),
                mint_a.clone(),
                mint_b.clone(),
                token_program_a.clone(),
                token_program_b.clone(),
                clock.clone(),
            ],
        )?;
    } else if amm_id == 1 {
        // Slot 1 = Kavach Stable: 13 accounts (output fee CPI to protocol + creator ATAs).
        let (protocol_ata, creator_ata) = match (stable_protocol_fee_ata, stable_creator_fee_ata) {
            (Some(p), Some(c)) => (p, c),
            _ => return Err(RouterError::StableSwapMissingFeeAccounts.into()),
        };
        let ix = Instruction {
            program_id: *amm_program.key,
            accounts: vec![
                AccountMeta::new(*pool.key, false),
                AccountMeta::new(*vault_in.key, true),
                AccountMeta::new(*vault_out.key, true),
                AccountMeta::new(*user_token_in.key, true),
                AccountMeta::new(*user_token_out.key, true),
                AccountMeta::new_readonly(*user.key, true),
                AccountMeta::new_readonly(*mint_a.key, false),
                AccountMeta::new_readonly(*mint_b.key, false),
                AccountMeta::new_readonly(*token_program_a.key, false),
                AccountMeta::new_readonly(*token_program_b.key, false),
                AccountMeta::new(*protocol_ata.key, true),
                AccountMeta::new(*creator_ata.key, true),
                AccountMeta::new_readonly(*clock.key, false),
            ],
            data: amm_data.to_vec(),
        };
        invoke(
            &ix,
            &[
                pool.clone(),
                vault_in.clone(),
                vault_out.clone(),
                user_token_in.clone(),
                user_token_out.clone(),
                user.clone(),
                mint_a.clone(),
                mint_b.clone(),
                token_program_a.clone(),
                token_program_b.clone(),
                protocol_ata.clone(),
                creator_ata.clone(),
                clock.clone(),
            ],
        )?;
    } else {
        let ix = Instruction {
            program_id: *amm_program.key,
            accounts: vec![
                AccountMeta::new(*pool.key, false),
                AccountMeta::new(*vault_in.key, true),
                AccountMeta::new(*vault_out.key, true),
                AccountMeta::new(*user_token_in.key, true),
                AccountMeta::new(*user_token_out.key, true),
                AccountMeta::new_readonly(*user.key, true),
                AccountMeta::new_readonly(*token_program_a.key, false),
                AccountMeta::new_readonly(*clock.key, false),
            ],
            data: amm_data.to_vec(),
        };
        invoke(
            &ix,
            &[
                pool.clone(),
                vault_in.clone(),
                vault_out.clone(),
                user_token_in.clone(),
                user_token_out.clone(),
                user.clone(),
                token_program_a.clone(),
                clock.clone(),
            ],
        )?;
    }
    Ok(())
}

/// UpdateConfig accounts: config (PDA), authority (signer).
/// Only authority (multisig) can update the 4 AMM program IDs.
fn update_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amm_program_ids: [Pubkey; 4],
) -> ProgramResult {
    let [config, authority] = match accounts {
        [a, b] => [a, b],
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    let (config_pda, _bump) = Pubkey::find_program_address(&[b"config"], program_id);
    if config.key != &config_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    if !authority.is_signer {
        return Err(RouterError::Unauthorized.into());
    }

    let mut config_data = config.data.borrow_mut();
    let mut router_config: RouterConfig =
        BorshDeserialize::try_from_slice(&config_data[..]).map_err(|_| RouterError::ConfigNotInitialized)?;
    if !router_config.is_initialized {
        return Err(RouterError::ConfigNotInitialized.into());
    }
    if authority.key != &router_config.authority {
        return Err(RouterError::Unauthorized.into());
    }

    router_config.amm_program_ids = amm_program_ids;
    let bytes = borsh::BorshSerialize::try_to_vec(&router_config).map_err(|_| ProgramError::InvalidAccountData)?;
    config_data[..bytes.len()].copy_from_slice(&bytes);

    Ok(())
}
