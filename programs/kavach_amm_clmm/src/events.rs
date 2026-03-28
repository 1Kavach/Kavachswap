//! Events for indexers.

use borsh::BorshSerialize;
use solana_program::{log::sol_log_data, program_error::ProgramError, pubkey::Pubkey};

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
    let ev = SwapEvent { pool, user, amount_in, amount_out, fee, timestamp };
    let data = ev.try_to_vec()?;
    sol_log_data(&[b"swap", data.as_slice()]);
    Ok(())
}
