//! Kavach rewards — v1: one reward token per farm, admin-only farm creation.
//! Pinocchio + pinocchio-tkn (TransferChecked). Works with SPL Token and Token-2022 LP/reward mints.

mod entry;
mod error;
mod processor;
mod state;
mod system_cpi;
