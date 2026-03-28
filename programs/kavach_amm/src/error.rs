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
}

impl From<AmmError> for ProgramError {
    fn from(e: AmmError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
