//! Events for indexers. Emit via sol_log_data.

use borsh::BorshSerialize;
use solana_program::{log::sol_log_data, program_error::ProgramError, pubkey::Pubkey};

pub fn emit_bonding_curve_created(
    pool: Pubkey,
    creator: Pubkey,
    mint: Pubkey,
    virtual_sol_reserves: u64,
    token_reserves: u64,
    graduation_threshold: u64,
    slot: u64,
    timestamp: i64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct Ev {
        pool: Pubkey,
        creator: Pubkey,
        mint: Pubkey,
        virtual_sol_reserves: u64,
        token_reserves: u64,
        graduation_threshold: u64,
        slot: u64,
        timestamp: i64,
    }
    let ev = Ev {
        pool,
        creator,
        mint,
        virtual_sol_reserves,
        token_reserves,
        graduation_threshold,
        slot,
        timestamp,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"bonding_curve_created", data.as_slice()]);
    Ok(())
}

pub fn emit_buy(
    pool: Pubkey,
    user: Pubkey,
    sol_in: u64,
    token_out: u64,
    protocol_fee: u64,
    creator_fee: u64,
    virtual_sol_reserves: u64,
    real_sol_reserves: u64,
    token_reserves: u64,
    price_sol_per_token: u64,
    slot: u64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct Ev {
        pool: Pubkey,
        user: Pubkey,
        sol_in: u64,
        token_out: u64,
        protocol_fee: u64,
        creator_fee: u64,
        virtual_sol_reserves: u64,
        real_sol_reserves: u64,
        token_reserves: u64,
        price_sol_per_token: u64,
        slot: u64,
    }
    let ev = Ev {
        pool,
        user,
        sol_in,
        token_out,
        protocol_fee,
        creator_fee,
        virtual_sol_reserves,
        real_sol_reserves,
        token_reserves,
        price_sol_per_token,
        slot,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"buy", data.as_slice()]);
    Ok(())
}

pub fn emit_sell(
    pool: Pubkey,
    user: Pubkey,
    token_in: u64,
    sol_out: u64,
    protocol_fee: u64,
    creator_fee: u64,
    virtual_sol_reserves: u64,
    real_sol_reserves: u64,
    token_reserves: u64,
    slot: u64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct Ev {
        pool: Pubkey,
        user: Pubkey,
        token_in: u64,
        sol_out: u64,
        protocol_fee: u64,
        creator_fee: u64,
        virtual_sol_reserves: u64,
        real_sol_reserves: u64,
        token_reserves: u64,
        slot: u64,
    }
    let ev = Ev {
        pool,
        user,
        token_in,
        sol_out,
        protocol_fee,
        creator_fee,
        virtual_sol_reserves,
        real_sol_reserves,
        token_reserves,
        slot,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"sell", data.as_slice()]);
    Ok(())
}

pub fn emit_graduation(
    pool: Pubkey,
    mint: Pubkey,
    real_sol_raised: u64,
    tokens_remaining: u64,
    clmm_program: Pubkey,
    slot: u64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct Ev {
        pool: Pubkey,
        mint: Pubkey,
        real_sol_raised: u64,
        tokens_remaining: u64,
        clmm_program: Pubkey,
        slot: u64,
    }
    let ev = Ev {
        pool,
        mint,
        real_sol_raised,
        tokens_remaining,
        clmm_program,
        slot,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"graduation", data.as_slice()]);
    Ok(())
}
