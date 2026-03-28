use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum ClmmError {
    #[error("Invalid amount")]
    InvalidAmount,
    #[error("Insufficient liquidity")]
    InsufficientLiquidity,
    #[error("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[error("Math overflow")]
    MathOverflow,
    #[error("Invalid bin step (1-10000)")]
    InvalidBinStep,
    #[error("Bin out of range")]
    BinOutOfRange,
    #[error("Pool not initialized")]
    PoolNotInitialized,
    #[error("Invalid fee split (protocol + creator must be 10000 bps)")]
    InvalidFeeSplit,
    #[error("Invalid token order (token_a < token_b)")]
    InvalidTokenOrder,
    #[error("Invalid fee parameters")]
    InvalidFeeParameters,
}

impl From<ClmmError> for ProgramError {
    fn from(e: ClmmError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
