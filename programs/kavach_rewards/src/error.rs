#![allow(dead_code)]

use pinocchio::program_error::ProgramError;

pub const ERR_INVALID_DISCRIMINATOR: u32 = 1;
pub const ERR_ALREADY_INITIALIZED: u32 = 2;
pub const ERR_NOT_INITIALIZED: u32 = 3;
pub const ERR_UNAUTHORIZED: u32 = 4;
pub const ERR_PAUSED: u32 = 5;
pub const ERR_INVALID_FARM: u32 = 6;
pub const ERR_INSUFFICIENT_STAKE: u32 = 7;
pub const ERR_MATH: u32 = 8;
pub const ERR_VAULT_MISMATCH: u32 = 9;
pub const ERR_MINT_MISMATCH: u32 = 10;

#[inline]
pub fn custom(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
