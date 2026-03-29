//! AMM math: constant product, LP mint, fee split. Overflow-safe. Same as 8tier.

use solana_program::program_error::ProgramError;

use crate::error::AmmError;

/// amount_out and fee from constant product with fee on input.
pub fn calculate_swap_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_numerator: u64,
    fee_denominator: u64,
) -> Result<(u64, u64), ProgramError> {
    if amount_in == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if reserve_in == 0 || reserve_out == 0 {
        return Err(AmmError::InsufficientLiquidity.into());
    }
    let fee_mult = fee_denominator
        .checked_sub(fee_numerator)
        .ok_or(AmmError::MathOverflow)?;
    let amount_in_with_fee = (amount_in as u128)
        .checked_mul(fee_mult as u128)
        .ok_or(AmmError::MathOverflow)?;
    let numerator = amount_in_with_fee
        .checked_mul(reserve_out as u128)
        .ok_or(AmmError::MathOverflow)?;
    let denominator = (reserve_in as u128)
        .checked_mul(fee_denominator as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_add(amount_in_with_fee)
        .ok_or(AmmError::MathOverflow)?;
    let amount_out = (numerator / denominator) as u64;
    let fee_amount = (amount_in as u128)
        .checked_mul(fee_numerator as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(fee_denominator as u128)
        .ok_or(AmmError::MathOverflow)? as u64;
    Ok((amount_out, fee_amount))
}

/// LP tokens to mint.
pub fn calculate_lp_tokens(
    amount_a: u64,
    amount_b: u64,
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
) -> Result<u64, ProgramError> {
    if amount_a == 0 || amount_b == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if lp_supply == 0 {
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .ok_or(AmmError::MathOverflow)?;
        return Ok(integer_sqrt(product) as u64);
    }
    if reserve_a == 0 || reserve_b == 0 {
        return Err(AmmError::InsufficientLiquidity.into());
    }
    let lp_from_a = (amount_a as u128)
        .checked_mul(lp_supply as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(reserve_a as u128)
        .ok_or(AmmError::MathOverflow)? as u64;
    let lp_from_b = (amount_b as u128)
        .checked_mul(lp_supply as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(reserve_b as u128)
        .ok_or(AmmError::MathOverflow)? as u64;
    Ok(std::cmp::min(lp_from_a, lp_from_b))
}

/// Amounts to return when burning LP tokens.
pub fn calculate_withdrawal_amounts(
    lp_tokens: u64,
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
) -> Result<(u64, u64), ProgramError> {
    if lp_tokens == 0 || lp_supply == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if lp_tokens > lp_supply {
        return Err(AmmError::InsufficientLiquidity.into());
    }
    let amount_a = (lp_tokens as u128)
        .checked_mul(reserve_a as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(lp_supply as u128)
        .ok_or(AmmError::MathOverflow)? as u64;
    let amount_b = (lp_tokens as u128)
        .checked_mul(reserve_b as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(lp_supply as u128)
        .ok_or(AmmError::MathOverflow)? as u64;
    Ok((amount_a, amount_b))
}

/// 50/50 split: protocol_fee_bps + creator_fee_bps must equal 10000.
pub fn split_fee(
    fee_amount: u64,
    protocol_bps: u64,
    creator_bps: u64,
) -> Result<(u64, u64), ProgramError> {
    if protocol_bps + creator_bps != 10000 {
        return Err(AmmError::InvalidFeeSplit.into());
    }
    let protocol_fee = (fee_amount as u128)
        .checked_mul(protocol_bps as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(10000)
        .ok_or(AmmError::MathOverflow)? as u64;
    let creator_fee = fee_amount
        .checked_sub(protocol_fee)
        .ok_or(AmmError::MathOverflow)?;
    Ok((protocol_fee, creator_fee))
}

/// Human **B per 1 A** as fraction `price_numerator / price_denominator` (not raw lamports).
/// First-deposit `amount_b` so implied spot matches:  
/// `amount_b = ceil(amount_a * num * 10^dec_b / (den * 10^dec_a))`.
pub fn amount_b_for_human_price_b_per_a(
    amount_a: u64,
    price_numerator: u128,
    price_denominator: u128,
    decimals_a: u8,
    decimals_b: u8,
) -> Result<u64, ProgramError> {
    if amount_a == 0 || price_numerator == 0 || price_denominator == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    let pow10 = |d: u8| -> Result<u128, ProgramError> {
        if d > 38 {
            return Err(AmmError::MathOverflow.into());
        }
        let mut x: u128 = 1;
        for _ in 0..d {
            x = x.checked_mul(10).ok_or(AmmError::MathOverflow)?;
        }
        Ok(x)
    };
    let scale_a = pow10(decimals_a)?;
    let scale_b = pow10(decimals_b)?;
    let num = (amount_a as u128)
        .checked_mul(price_numerator)
        .ok_or(AmmError::MathOverflow)?
        .checked_mul(scale_b)
        .ok_or(AmmError::MathOverflow)?;
    let den = price_denominator
        .checked_mul(scale_a)
        .ok_or(AmmError::MathOverflow)?;
    if den == 0 {
        return Err(AmmError::MathOverflow.into());
    }
    let q = num
        .checked_add(den.checked_sub(1).ok_or(AmmError::MathOverflow)?)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(den)
        .ok_or(AmmError::MathOverflow)?;
    u64::try_from(q).map_err(|_| AmmError::MathOverflow.into())
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
