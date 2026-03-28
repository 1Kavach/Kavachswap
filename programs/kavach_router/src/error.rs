use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum RouterError {
    #[error("Invalid AMM index (must be 0-3)")]
    InvalidAmmId,
    #[error("Router config not initialized")]
    ConfigNotInitialized,
    #[error("Config mismatch: account is not the AMM for this index")]
    ConfigMismatch,
    #[error("UpdateConfig: authority must sign and match config")]
    Unauthorized,
    #[error("Stable AMM (slot 1) requires protocol + creator fee ATAs in account list")]
    StableSwapMissingFeeAccounts,
    #[error("Multi-hop: account count must be 20, 22, or 24 for these amm_ids (add 2 fee ATAs per Stable hop)")]
    MultihopAccountLayout,
}

impl From<RouterError> for ProgramError {
    fn from(e: RouterError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
