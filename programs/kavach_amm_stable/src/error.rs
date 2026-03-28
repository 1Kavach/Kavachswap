use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum AmmError {
    #[error("Invalid amount")]
    InvalidAmount,
    #[error("Insufficient liquidity")]
    InsufficientLiquidity,
    #[error("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[error("Math overflow")]
    MathOverflow,
    #[error("Invalid fee split (must sum to 10000 bps)")]
    InvalidFeeSplit,
    #[error("Pool already initialized")]
    PoolAlreadyInitialized,
    #[error("Pool not initialized")]
    PoolNotInitialized,
    #[error("Invalid fee parameters")]
    InvalidFeeParameters,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Invalid token account")]
    InvalidTokenAccount,
    #[error("Invalid token order (token_a must be < token_b)")]
    InvalidTokenOrder,
    #[error("Invalid amplification factor (must be 1-10000)")]
    InvalidAmpFactor,
    #[error("Invalid vault (must match pool state)")]
    InvalidVault,
    #[error("Invalid fee recipient ATA")]
    InvalidFeeRecipient,
    #[error("Invalid sysvar")]
    InvalidSysvar,
    #[error("Invalid mint (must match pool state)")]
    InvalidMint,
    #[error("Curve invariant violated after swap")]
    InvariantViolated,
}

impl From<AmmError> for ProgramError {
    fn from(e: AmmError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
