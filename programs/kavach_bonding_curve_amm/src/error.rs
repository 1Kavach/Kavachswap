use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum BcError {
    #[error("Slippage exceeded — output below minimum")]
    SlippageExceeded,
    #[error("Curve already graduated to CLMM")]
    AlreadyGraduated,
    #[error("Curve not yet ready to graduate")]
    NotReadyToGraduate,
    #[error("Anti-snipe: buy too large in launch window")]
    AntiSnipeTooLarge,
    #[error("Math overflow")]
    MathOverflow,
    #[error("Zero amount")]
    ZeroAmount,
    #[error("Curve is paused")]
    CurvePaused,
    #[error("Invalid fee bps — must be <= 500")]
    InvalidFeeBps,
    #[error("Insufficient token reserves")]
    InsufficientTokenReserves,
    #[error("Insufficient SOL reserves")]
    InsufficientSolReserves,
    #[error("Config not initialized")]
    ConfigNotInitialized,
    #[error("Unauthorized — admin only")]
    Unauthorized,
    #[error("Invalid config PDA")]
    InvalidConfigPda,
    #[error("Invalid pool PDA")]
    InvalidPoolPda,
    #[error("Invalid sol vault PDA")]
    InvalidSolVaultPda,
}

impl From<BcError> for ProgramError {
    fn from(e: BcError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
