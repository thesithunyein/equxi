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
    #[msg("Unauthorized: only authority can perform this action")]
    AuthorityRequired,
    #[msg("Agent is already deactivated")]
    AlreadyDeactivated,
    #[msg("Agent is not active")]
    AgentNotActive,
    #[msg("Constraint already exists for this type")]
    ConstraintExists,
    #[msg("Invalid trust score (must be 0-100)")]
    InvalidTrustScore,
    #[msg("Slashing authority required")]
    SlashingAuthorityRequired,
    #[msg("Arithmetic overflow")]
    Overflow,
}
