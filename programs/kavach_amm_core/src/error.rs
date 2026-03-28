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
    #[error("Invalid fee tier (must be one of the allowed values)")]
    InvalidFeeTier,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Invalid token account")]
    InvalidTokenAccount,
    #[error("Invalid token order (token_a must be < token_b)")]
    InvalidTokenOrder,
    #[error("Vault or mint does not belong to this pool")]
    InvalidVault,
    #[error("Invalid fee recipient ATA")]
    InvalidFeeRecipient,
    #[error("Invalid sysvar account")]
    InvalidSysvar,
    #[error("Initial listing liquidity only when pool has zero reserves and LP supply")]
    NotInitialLiquidity,
    #[error("Invalid price ratio")]
    InvalidPriceRatio,
}

impl From<AmmError> for ProgramError {
    fn from(e: AmmError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
