use anchor_lang::prelude::*;

#[error_code]
pub enum EquxiError {
    #[msg("Agent name too long (max 32 characters)")]
    NameTooLong,
    #[msg("Bond amount must be at least 0.1 SOL (100_000_000 lamports)")]
    BondTooSmall,
    #[msg("Bond is not active or has expired")]
    BondInactive,
    #[msg("Bond has not expired yet")]
    BondNotExpired,
    #[msg("Insufficient bond balance for slashing")]
    InsufficientBond,
    #[msg("Unauthorized: only the operator can perform this action")]
    Unauthorized,
    #[msg("Agent is not active")]
    AgentNotActive,
    #[msg("Invalid trust score (must be 0-100)")]
    InvalidTrustScore,
    #[msg("Slashing authority required")]
    SlashingAuthorityRequired,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Compensation exceeds the amount seized in that slash")]
    ExceedsSlashAmount,
    #[msg("Escrow vault does not hold enough slashed funds")]
    VaultInsufficient,
    #[msg("Slash record has already been compensated")]
    AlreadyCompensated,
    #[msg("Agent has reached the maximum number of constraints")]
    TooManyConstraints,
    #[msg("Initialize must be signed by the program upgrade authority")]
    InvalidAdminAuthority,
    #[msg("ProgramData account does not belong to this program")]
    ProgramDataMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
}
