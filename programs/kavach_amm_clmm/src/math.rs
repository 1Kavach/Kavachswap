//! CLMM swap math: one bin (or traverse bins) CPMM, fee on input. 50/50 split of fee.
//! Per-bin constant product like Meteora DLMM / Raydium CLMM.

use solana_program::program_error::ProgramError;

use crate::error::ClmmError;

const BPS: u64 = 10_000;

/// Swap across a single bin (CPMM): amount_in -> amount_out, fee on input.
/// Returns (amount_out, fee_amount) and the amount_in actually consumed (for multi-bin: same as amount_in for single bin).
pub fn swap_bin(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_bps: u64,
) -> Result<(u64, u64, u64), ProgramError> {
    if amount_in == 0 {
        return Err(ClmmError::InvalidAmount.into());
    }
    if reserve_out == 0 {
        return Err(ClmmError::InsufficientLiquidity.into());
    }
    let amount_in_after_fee = (amount_in as u128)
        .checked_mul(BPS.saturating_sub(fee_bps) as u128)
        .ok_or(ClmmError::MathOverflow)?
        .checked_div(BPS as u128)
        .ok_or(ClmmError::MathOverflow)?;
    let fee_amount = amount_in
        .checked_sub(amount_in_after_fee as u64)
        .ok_or(ClmmError::MathOverflow)?;
    let k = (reserve_in as u128)
        .checked_mul(reserve_out as u128)
        .ok_or(ClmmError::MathOverflow)?;
    let new_reserve_in = (reserve_in as u128)
        .checked_add(amount_in_after_fee)
        .ok_or(ClmmError::MathOverflow)?;
    let new_reserve_out = k
        .checked_div(new_reserve_in)
        .ok_or(ClmmError::MathOverflow)?;
    let amount_out = (reserve_out as u128)
        .saturating_sub(new_reserve_out) as u64;
    let amount_out = amount_out.min(reserve_out);
    Ok((amount_out, fee_amount, amount_in))
}

/// Liquidity shares for adding to a bin. First in bin: sqrt(a*b); else proportional.
pub fn bin_shares(
    amount_a: u64,
    amount_b: u64,
    reserve_a: u64,
    reserve_b: u64,
    existing_shares: u128,
) -> Result<u128, ProgramError> {
    if amount_a == 0 && amount_b == 0 {
        return Err(ClmmError::InvalidAmount.into());
    }
    if existing_shares == 0 {
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .ok_or(ClmmError::MathOverflow)?;
        return Ok(integer_sqrt(product));
    }
    if reserve_a == 0 && reserve_b == 0 {
        return Err(ClmmError::InsufficientLiquidity.into());
    }
    let shares_from_a = if reserve_a > 0 {
        (amount_a as u128)
            .checked_mul(existing_shares)
            .ok_or(ClmmError::MathOverflow)?
            .checked_div(reserve_a as u128)
            .ok_or(ClmmError::MathOverflow)?
    } else {
        u128::MAX
    };
    let shares_from_b = if reserve_b > 0 {
        (amount_b as u128)
            .checked_mul(existing_shares)
            .ok_or(ClmmError::MathOverflow)?
            .checked_div(reserve_b as u128)
            .ok_or(ClmmError::MathOverflow)?
    } else {
        u128::MAX
    };
    Ok(shares_from_a.min(shares_from_b))
}

fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut z = (n + 1) / 2;
    let mut y = n;
    while z < y {
        y = z;
        z = (n / z + z) / 2;
    }
    y
}
