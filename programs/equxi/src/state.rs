use anchor_lang::prelude::*;

/// Maximum number of behavioral constraints that may be attached to one agent.
pub const MAX_CONSTRAINTS: u16 = 16;

/// Global config with admin authority
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,           // Can execute slashes
    pub total_agents: u64,
    pub total_bonds: u64,
    pub total_slashed: u64,
    pub bumped: u8,
}

/// Program-owned escrow that holds slashed collateral until it is paid out.
///
/// Slashed lamports move `bond -> vault` and compensation moves `vault -> victim`.
/// The admin never takes custody of slashed funds.
///
/// Invariant: `vault.lamports() == rent_exempt_min + vault.available()`
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Cumulative lamports moved into the vault by `execute_slash`.
    pub total_slashed: u64,
    /// Cumulative lamports paid out of the vault by `compensate_victim`.
    pub total_compensated: u64,
    pub bumped: u8,
}

impl Vault {
    /// Lamports currently available to compensate victims.
    pub fn available(&self) -> u64 {
        self.total_slashed.saturating_sub(self.total_compensated)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub owner: Pubkey,
    pub name: [u8; 32],
    pub agent_type: AgentType,
    pub trust_score: u8,
    pub status: AgentStatus,
    pub bond_address: Pubkey,
    /// Number of constraints created for this agent. Used as a PDA seed so an
    /// agent can hold many constraints instead of exactly one.
    pub constraint_count: u16,
    pub created_at: i64,
    pub bumped: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bond {
    pub agent: Pubkey,
    pub operator: Pubkey,
    pub amount: u64,
    pub lock_duration: i64,
    pub locked_at: i64,
    pub expires_at: i64,
    pub is_active: bool,
    pub bumped: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Constraint {
    pub agent: Pubkey,
    pub constraint_type: ConstraintType,
    pub params: ConstraintParams,
    pub is_enforced: bool,
    pub created_at: i64,
    pub bumped: u8,
}

/// Slash record uses nonce to avoid PDA collision
#[account]
#[derive(InitSpace)]
pub struct SlashRecord {
    pub agent: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub reason: [u8; 128],
    pub nonce: u64,
    pub timestamp: i64,
    pub victim: Option<Pubkey>,
    pub compensated: bool,
    pub bumped: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AgentType {
    Trader,
    Oracle,
    DeFi,
    Payment,
    NFT,
    Governance,
    Bridge,
    Custom,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AgentStatus {
    Active,
    Pending,
    Slashed,
    Deactivated,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ConstraintType {
    SpendLimit,
    ProgramAllowlist,
    Timelock,
    Velocity,
    Custom,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct ConstraintParams {
    pub max_amount: u64,
    pub max_per_period: u64,
    pub period_seconds: i64,
    pub timelock_seconds: i64,
    pub allowed_programs: [Pubkey; 8],
}
