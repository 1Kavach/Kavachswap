//! Token-2022–aware reads and transfers (extension-aware unpack, transfer_checked).
//! Classic SPL: unpack with Pack; Token-2022: StateWithExtensions. Transfers use transfer_checked for both.

use solana_program::program_error::ProgramError;
use solana_program::program_pack::Pack;
use solana_program::pubkey::Pubkey;
use spl_token::state::{Account as TokenAccountState, Mint as MintState};
use spl_token_2022::extension::StateWithExtensions;
use spl_token_2022::state::{Account as Token2022Account, Mint as Token2022Mint};

/// SPL Associated Token Program ID (ATA PDA derivation).
const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey = solana_program::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// Associated token address for (wallet, mint). Same formula as spl_associated_token_account.
pub fn get_associated_token_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program(wallet, mint, &spl_token::id())
}

/// Associated token address for (wallet, mint, token_program). Required for Token-2022 mints.
pub fn get_associated_token_address_with_program(
    wallet: &Pubkey,
    mint: &Pubkey,
    token_program_id: &Pubkey,
) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), token_program_id.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

/// SPL Token-2022 program ID on Solana.
pub fn token_2022_id() -> Pubkey {
    spl_token_2022::id()
}

pub fn is_token_2022(program_id: &Pubkey) -> bool {
    *program_id == spl_token_2022::id()
}

/// Only SPL Token and Token-2022 are allowed for vault/mint/transfer operations. Reject any other program ID.
pub fn is_allowed_token_program(program_id: &Pubkey) -> bool {
    *program_id == spl_token::id() || *program_id == spl_token_2022::id()
}

/// Read token account amount. Works for both classic and Token-2022 (extension-aware).
pub fn account_amount(data: &[u8], token_program_id: &Pubkey) -> Result<u64, ProgramError> {
    if is_token_2022(token_program_id) {
        let account = StateWithExtensions::<Token2022Account>::unpack(data)?;
        Ok(account.base.amount)
    } else {
        let account = TokenAccountState::unpack(data)?;
        Ok(account.amount)
    }
}

/// Read mint supply. Works for both classic and Token-2022.
pub fn mint_supply(data: &[u8], token_program_id: &Pubkey) -> Result<u64, ProgramError> {
    if is_token_2022(token_program_id) {
        let mint = StateWithExtensions::<Token2022Mint>::unpack(data)?;
        Ok(mint.base.supply)
    } else {
        let mint = MintState::unpack(data)?;
        Ok(mint.supply)
    }
}

/// Read mint decimals. Works for both classic and Token-2022. Required for transfer_checked.
pub fn mint_decimals(data: &[u8], token_program_id: &Pubkey) -> Result<u8, ProgramError> {
    if is_token_2022(token_program_id) {
        let mint = StateWithExtensions::<Token2022Mint>::unpack(data)?;
        Ok(mint.base.decimals)
    } else {
        let mint = MintState::unpack(data)?;
        Ok(mint.decimals)
    }
}
