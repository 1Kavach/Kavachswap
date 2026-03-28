//! Events for indexers and top-LPs. Emit on add/remove liquidity and swap.

use borsh::BorshSerialize;
use solana_program::{log::sol_log_data, program_error::ProgramError, pubkey::Pubkey};

/// Emit when liquidity is added — used for top LPs leaderboard.
pub fn emit_add_liquidity(
    pool: Pubkey,
    user: Pubkey,
    amount_a: u64,
    amount_b: u64,
    lp_tokens: u64,
    timestamp: i64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct AddLiqEvent {
        pool: Pubkey,
        user: Pubkey,
        amount_a: u64,
        amount_b: u64,
        lp_tokens: u64,
        timestamp: i64,
    }
    let ev = AddLiqEvent {
        pool,
        user,
        amount_a,
        amount_b,
        lp_tokens,
        timestamp,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"add_liquidity", data.as_slice()]);
    Ok(())
}

/// Emit when liquidity is removed — for top LPs and analytics.
pub fn emit_remove_liquidity(
    pool: Pubkey,
    user: Pubkey,
    lp_tokens: u64,
    amount_a: u64,
    amount_b: u64,
    timestamp: i64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct RemoveLiqEvent {
        pool: Pubkey,
        user: Pubkey,
        lp_tokens: u64,
        amount_a: u64,
        amount_b: u64,
        timestamp: i64,
    }
    let ev = RemoveLiqEvent {
        pool,
        user,
        lp_tokens,
        amount_a,
        amount_b,
        timestamp,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"remove_liquidity", data.as_slice()]);
    Ok(())
}

/// Emit on swap for volume/tracking.
pub fn emit_swap(
    pool: Pubkey,
    user: Pubkey,
    amount_in: u64,
    amount_out: u64,
    fee: u64,
    timestamp: i64,
) -> Result<(), ProgramError> {
    #[derive(BorshSerialize)]
    struct SwapEvent {
        pool: Pubkey,
        user: Pubkey,
        amount_in: u64,
        amount_out: u64,
        fee: u64,
        timestamp: i64,
    }
    let ev = SwapEvent {
        pool,
        user,
        amount_in,
        amount_out,
        fee,
        timestamp,
    };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"swap", data.as_slice()]);
    Ok(())
}
