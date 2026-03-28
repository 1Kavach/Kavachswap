//! StableSwap-style invariant on **18-decimal normalized** balances (u128).
//! Newton for D, quadratic for y; fee applied to **output** (gross out from curve).

use solana_program::program_error::ProgramError;

use crate::error::AmmError;
use crate::state::BPS_DENOMINATOR;

/// Internal scaling for D Newton so D_s^3 fits in u128.
const INNER_SCALE: u128 = 1_000_000_000_000;
const NEWTON_MAX_ITERS: u8 = 64;

/// 10^0 .. 10^18 for decimal normalization.
fn ten_pow(exp: u32) -> Result<u128, ProgramError> {
    const T: [u128; 19] = [
        1,
        10,
        100,
        1_000,
        10_000,
        100_000,
        1_000_000,
        10_000_000,
        100_000_000,
        1_000_000_000,
        10_000_000_000,
        100_000_000_000,
        1_000_000_000_000,
        10_000_000_000_000,
        100_000_000_000_000,
        1_000_000_000_000_000,
        10_000_000_000_000_000,
        100_000_000_000_000_000,
        1_000_000_000_000_000_000,
    ];
    T.get(exp as usize).copied().ok_or(AmmError::MathOverflow.into())
}

/// Raw token amount → 18-decimal fixed point (u128).
pub fn to_norm(amount: u64, decimals: u8) -> Result<u128, ProgramError> {
    let shift = (18u32).saturating_sub(decimals as u32);
    let f = ten_pow(shift)?;
    (amount as u128)
        .checked_mul(f)
        .ok_or(AmmError::MathOverflow.into())
}

/// Floor: normalized → raw token units.
pub fn from_norm_floor(n: u128, decimals: u8) -> Result<u64, ProgramError> {
    let shift = (18u32).saturating_sub(decimals as u32);
    let f = ten_pow(shift)?;
    let q = n.checked_div(f).ok_or(AmmError::MathOverflow)?;
    u64::try_from(q).map_err(|_| AmmError::MathOverflow.into())
}

/// Ceiling: normalized → raw (favor pool on rounding).
pub fn from_norm_ceil(n: u128, decimals: u8) -> Result<u64, ProgramError> {
    let shift = (18u32).saturating_sub(decimals as u32);
    let f = ten_pow(shift)?;
    let q = n.checked_add(f.checked_sub(1).ok_or(AmmError::MathOverflow)?)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(f)
        .ok_or(AmmError::MathOverflow)?;
    u64::try_from(q).map_err(|_| AmmError::MathOverflow.into())
}

/// Curve-style D via Newton on scaled reserves. `amp` is A in Ann = 4*A (n=2).
pub fn calculate_d_curve(x_norm: u128, y_norm: u128, amp: u128) -> Result<u128, ProgramError> {
    let x_s = x_norm.checked_div(INNER_SCALE).unwrap_or(0).max(1);
    let y_s = y_norm.checked_div(INNER_SCALE).unwrap_or(0).max(1);
    let prod_s = x_s
        .checked_mul(y_s)
        .ok_or(AmmError::MathOverflow)?;
    let sum_s = x_s
        .checked_add(y_s)
        .ok_or(AmmError::MathOverflow)?;
    let ann = amp.checked_mul(4).ok_or(AmmError::MathOverflow)?;
    let ann_minus_one = ann.checked_sub(1).ok_or(AmmError::MathOverflow)?;

    let mut d_s = sum_s;
    for _ in 0..NEWTON_MAX_ITERS {
        let d_s2 = d_s.checked_mul(d_s).ok_or(AmmError::MathOverflow)?;
        let d_s3 = d_s2.checked_mul(d_s).ok_or(AmmError::MathOverflow)?;
        let linear = prod_s
            .checked_mul(ann_minus_one)
            .ok_or(AmmError::MathOverflow)?
            .checked_mul(4)
            .ok_or(AmmError::MathOverflow)?
            .checked_mul(d_s)
            .ok_or(AmmError::MathOverflow)?;
        let constant = prod_s
            .checked_mul(ann)
            .ok_or(AmmError::MathOverflow)?
            .checked_mul(4)
            .ok_or(AmmError::MathOverflow)?
            .checked_mul(sum_s)
            .ok_or(AmmError::MathOverflow)?;
        let f = d_s3
            .checked_add(linear)
            .ok_or(AmmError::MathOverflow)?
            .checked_sub(constant)
            .ok_or(AmmError::MathOverflow)?;
        let fp = d_s2
            .checked_mul(3)
            .ok_or(AmmError::MathOverflow)?
            .checked_add(
                prod_s
                    .checked_mul(ann_minus_one)
                    .ok_or(AmmError::MathOverflow)?
                    .checked_mul(4)
                    .ok_or(AmmError::MathOverflow)?,
            )
            .ok_or(AmmError::MathOverflow)?;
        if fp == 0 {
            break;
        }
        let step = f.checked_div(fp).ok_or(AmmError::MathOverflow)?;
        if step == 0 {
            break;
        }
        d_s = d_s.saturating_sub(step);
        if d_s == 0 {
            d_s = 1;
        }
    }
    d_s.checked_mul(INNER_SCALE)
        .ok_or(AmmError::MathOverflow.into())
}

/// y given new x and D (normalized).
pub fn calculate_y_curve(new_x_norm: u128, d_norm: u128, amp: u128) -> Result<u128, ProgramError> {
    let x_s = new_x_norm.checked_div(INNER_SCALE).unwrap_or(0).max(1);
    let d_s = d_norm.checked_div(INNER_SCALE).unwrap_or(0).max(1);
    let ann = amp.checked_mul(4).ok_or(AmmError::MathOverflow)?;
    let b_s = x_s
        .checked_add(d_s.checked_div(ann).ok_or(AmmError::MathOverflow)?)
        .ok_or(AmmError::MathOverflow)?;
    let d_s3 = d_s
        .checked_mul(d_s)
        .ok_or(AmmError::MathOverflow)?
        .checked_mul(d_s)
        .ok_or(AmmError::MathOverflow)?;
    let c_s = d_s3
        .checked_div(16)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(amp.max(1))
        .ok_or(AmmError::MathOverflow)?
        .checked_div(x_s)
        .ok_or(AmmError::MathOverflow)?;
    let d_minus_b = d_s.checked_sub(b_s).ok_or(AmmError::MathOverflow)?;
    let disc = d_minus_b
        .checked_mul(d_minus_b)
        .ok_or(AmmError::MathOverflow)?
        .checked_add(c_s.checked_mul(4).ok_or(AmmError::MathOverflow)?)
        .ok_or(AmmError::MathOverflow)?;
    let sqrt_disc = integer_sqrt(disc);
    let two_y = d_minus_b
        .checked_add(sqrt_disc)
        .ok_or(AmmError::MathOverflow)?;
    let y_s = two_y.checked_div(2).ok_or(AmmError::MathOverflow)?;
    y_s.checked_mul(INNER_SCALE)
        .ok_or(AmmError::MathOverflow.into())
}

/// Swap: full `amount_in` added to reserve_in; **fee on gross output** (in normalized out units).
/// Returns (amount_out_user, fee_total_raw_out, protocol_fee_raw, creator_fee_raw, d_before, d_after).
pub fn calculate_stable_swap_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    decimals_in: u8,
    decimals_out: u8,
    amp_factor: u64,
    swap_fee_bps: u64,
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
) -> Result<(u64, u64, u64, u64, u128, u128), ProgramError> {
    if amount_in == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    if reserve_in == 0 || reserve_out == 0 {
        return Err(AmmError::InsufficientLiquidity.into());
    }
    if protocol_fee_bps + creator_fee_bps != 10_000 {
        return Err(AmmError::InvalidFeeSplit.into());
    }

    let x0 = to_norm(reserve_in, decimals_in)?;
    let y0 = to_norm(reserve_out, decimals_out)?;
    let dx = to_norm(amount_in, decimals_in)?;
    let amp = amp_factor as u128;

    let d0 = calculate_d_curve(x0, y0, amp)?;
    let x1 = x0.checked_add(dx).ok_or(AmmError::MathOverflow)?;
    let y1 = calculate_y_curve(x1, d0, amp)?;
    let gross_out_norm = y0.checked_sub(y1).ok_or(AmmError::MathOverflow)?;
    if gross_out_norm == 0 {
        return Err(AmmError::InvalidAmount.into());
    }

    let gross_raw = from_norm_floor(gross_out_norm, decimals_out)?;
    if gross_raw == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    let fee_total = (gross_raw as u128)
        .checked_mul(swap_fee_bps as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(AmmError::MathOverflow)? as u64;
    let user_out = gross_raw
        .checked_sub(fee_total)
        .ok_or(AmmError::MathOverflow)?;
    if user_out == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    let protocol_fee = (fee_total as u128)
        .checked_mul(protocol_fee_bps as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(AmmError::MathOverflow)? as u64;
    let creator_fee = fee_total
        .checked_sub(protocol_fee)
        .ok_or(AmmError::MathOverflow)?;

    let y_after = y0
        .checked_sub(gross_out_norm)
        .ok_or(AmmError::MathOverflow)?;
    let d_after = calculate_d_curve(x1, y_after, amp)?;

    Ok((user_out, fee_total, protocol_fee, creator_fee, d0, d_after))
}

pub fn assert_invariant_relaxed(d_before: u128, d_after: u128) -> Result<(), ProgramError> {
    if d_after + 1 < d_before {
        return Err(AmmError::InvariantViolated.into());
    }
    Ok(())
}

/// LP mint: first deposit geometric mean in norm space; else `supply * (D1 - D0) / D0`.
pub fn calculate_lp_tokens(
    amount_a: u64,
    amount_b: u64,
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
    dec_a: u8,
    dec_b: u8,
    amp: u64,
) -> Result<u64, ProgramError> {
    if amount_a == 0 || amount_b == 0 {
        return Err(AmmError::InvalidAmount.into());
    }
    let amp_u = amp as u128;
    let da = to_norm(amount_a, dec_a)?;
    let db = to_norm(amount_b, dec_b)?;
    if lp_supply == 0 {
        let p = da.checked_mul(db).ok_or(AmmError::MathOverflow)?;
        let s = integer_sqrt(p);
        return u64::try_from(s.min(u128::from(u64::MAX))).map_err(|_| AmmError::MathOverflow.into());
    }
    if reserve_a == 0 || reserve_b == 0 {
        return Err(AmmError::InsufficientLiquidity.into());
    }
    let x0 = to_norm(reserve_a, dec_a)?;
    let y0 = to_norm(reserve_b, dec_b)?;
    let d0 = calculate_d_curve(x0, y0, amp_u)?;
    let x1 = x0.checked_add(da).ok_or(AmmError::MathOverflow)?;
    let y1 = y0.checked_add(db).ok_or(AmmError::MathOverflow)?;
    let d1 = calculate_d_curve(x1, y1, amp_u)?;
    if d1 <= d0 {
        return Err(AmmError::InsufficientLiquidity.into());
    }
    let num = (lp_supply as u128)
        .checked_mul(d1.checked_sub(d0).ok_or(AmmError::MathOverflow)?)
        .ok_or(AmmError::MathOverflow)?;
    let lp = num.checked_div(d0).ok_or(AmmError::MathOverflow)?;
    u64::try_from(lp).map_err(|_| AmmError::MathOverflow.into())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_norm_and_from_norm_floor_roundtrip_6_decimals() {
        let raw = 1_234_567u64;
        let n = to_norm(raw, 6).unwrap();
        assert_eq!(from_norm_floor(n, 6).unwrap(), raw);
    }

    #[test]
    fn to_norm_9_decimals() {
        let n = to_norm(1u64, 9).unwrap();
        assert_eq!(n, 1_000_000_000u128);
    }

    #[test]
    fn calculate_d_curve_symmetric_positive() {
        let x = to_norm(1_000_000_000u64, 6).unwrap();
        let y = to_norm(1_000_000_000u64, 6).unwrap();
        let d = calculate_d_curve(x, y, 100).unwrap();
        assert!(d > 0);
    }

    #[test]
    fn calculate_y_curve_consistent_with_d() {
        let x0 = to_norm(500_000_000u64, 6).unwrap();
        let y0 = to_norm(500_000_000u64, 6).unwrap();
        let amp = 200u128;
        let d = calculate_d_curve(x0, y0, amp).unwrap();
        let y_at_x0 = calculate_y_curve(x0, d, amp).unwrap();
        assert!(y_at_x0 <= y0 + 1 && y_at_x0 + 1 >= y0);
    }

    #[test]
    fn swap_output_fee_splits_to_protocol_and_creator() {
        let reserve = 10_000_000_000u64;
        let (user_out, fee_total, protocol_fee, creator_fee, _d0, _d1) =
            calculate_stable_swap_output(
                50_000_000u64,
                reserve,
                reserve,
                6,
                6,
                100,
                30,
                5000,
                5000,
            )
            .unwrap();
        assert!(user_out > 0);
        assert_eq!(protocol_fee + creator_fee, fee_total);
    }

    #[test]
    fn swap_rejects_bad_fee_split() {
        let e = calculate_stable_swap_output(1, 1000, 1000, 6, 6, 100, 30, 4000, 4000);
        assert!(e.is_err());
    }

    #[test]
    fn swap_rejects_zero_amount_in() {
        assert!(calculate_stable_swap_output(0, 1000, 1000, 6, 6, 100, 4, 5000, 5000).is_err());
    }

    #[test]
    fn lp_tokens_first_deposit_geometric_normalized() {
        // First mint: sqrt(to_norm(a) * to_norm(b)) in 18-decimal space.
        // 1e6 raw (1 USDC) → 1e18 norm; 4e6 raw → 4e18 norm; sqrt = 2e18.
        let lp = calculate_lp_tokens(1_000_000, 4_000_000, 0, 0, 0, 6, 6, 100).unwrap();
        assert_eq!(lp, 2_000_000_000_000_000_000u64);
    }

    #[test]
    fn withdrawal_amounts_proportional() {
        let (a, b) = calculate_withdrawal_amounts(500, 10_000, 30_000, 1_000).unwrap();
        assert_eq!(a, 5_000);
        assert_eq!(b, 15_000);
    }

    #[test]
    fn assert_invariant_relaxed_allows_small_dip() {
        assert!(assert_invariant_relaxed(1000, 999).is_ok());
    }

    #[test]
    fn assert_invariant_relaxed_rejects_large_drop() {
        assert!(assert_invariant_relaxed(1000, 998).is_err());
    }
}
