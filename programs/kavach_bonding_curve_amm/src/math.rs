//! Constant-product curve math: k = (virtual_sol + real_sol) * token_reserves.

use crate::error::BcError;

const BPS_DENOM: u64 = 10_000;

/// Tokens out for sol_in (before fees). sol_effective = virtual_sol + real_sol.
pub fn tokens_out(
    virtual_sol: u64,
    real_sol: u64,
    token_reserves: u64,
    sol_in: u64,
) -> Result<u64, BcError> {
    let sol_effective = virtual_sol
        .checked_add(real_sol)
        .ok_or(BcError::MathOverflow)?;
    let numerator = (token_reserves as u128)
        .checked_mul(sol_in as u128)
        .ok_or(BcError::MathOverflow)?;
    let denominator = (sol_effective as u128)
        .checked_add(sol_in as u128)
        .ok_or(BcError::MathOverflow)?;
    let out = numerator
        .checked_div(denominator)
        .ok_or(BcError::MathOverflow)?;
    Ok(out as u64)
}

/// SOL out for token_in (before fees).
pub fn sol_out(
    virtual_sol: u64,
    real_sol: u64,
    token_reserves: u64,
    token_in: u64,
) -> Result<u64, BcError> {
    let sol_effective = virtual_sol
        .checked_add(real_sol)
        .ok_or(BcError::MathOverflow)?;
    let numerator = (sol_effective as u128)
        .checked_mul(token_in as u128)
        .ok_or(BcError::MathOverflow)?;
    let denominator = (token_reserves as u128)
        .checked_add(token_in as u128)
        .ok_or(BcError::MathOverflow)?;
    let out = numerator
        .checked_div(denominator)
        .ok_or(BcError::MathOverflow)?;
    Ok(out as u64)
}

/// Spot price lamports-per-token (scaled 1e6). For display only.
pub fn spot_price(virtual_sol: u64, real_sol: u64, token_reserves: u64) -> u64 {
    if token_reserves == 0 {
        return 0;
    }
    let sol_eff = virtual_sol.saturating_add(real_sol);
    ((sol_eff as u128) * 1_000_000 / (token_reserves as u128)) as u64
}

/// (net_amount, fee).
pub fn apply_fee(amount: u64, bps: u64) -> (u64, u64) {
    let fee = amount * bps / BPS_DENOM;
    (amount.saturating_sub(fee), fee)
}
