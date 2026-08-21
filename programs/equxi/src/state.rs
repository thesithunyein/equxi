use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub owner: Pubkey,           // Operator wallet
    pub name: [u8; 32],          // Agent name (fixed size)
    pub agent_type: AgentType,
    pub trust_score: u8,         // 0-100
    pub status: AgentStatus,
    pub bond_address: Pubkey,    // Associated bond PDA
    pub created_at: i64,
    pub bumped: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bond {
    pub agent: Pubkey,           // Agent PDA
    pub operator: Pubkey,        // Operator wallet
    pub amount: u64,             // SOL locked (lamports)
    pub lock_duration: i64,      // Seconds
    pub locked_at: i64,
    pub expires_at: i64,
    pub is_active: bool,
    pub bumped: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Constraint {
    pub agent: Pubkey,           // Agent PDA
    pub constraint_type: ConstraintType,
    pub params: ConstraintParams,
    pub is_enforced: bool,
    pub created_at: i64,
    pub bumped: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SlashRecord {
    pub agent: Pubkey,
    pub authority: Pubkey,       // Who executed the slash
    pub amount: u64,
    pub reason: [u8; 128],
    pub timestamp: i64,
    pub victim: Option<Pubkey>,
    pub compensated: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AgentStatus {
    Active,
    Pending,
    Slashed,
    Deactivated,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ConstraintType {
    SpendLimit,
    ProgramAllowlist,
    Timelock,
    Velocity,
    Custom,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct ConstraintParams {
    pub max_amount: u64,         // For SpendLimit: max lamports per tx
    pub max_per_period: u64,     // For Velocity: max txs per period
    pub period_seconds: i64,     // Period duration in seconds
    pub timelock_seconds: i64,   // For Timelock: delay in seconds
    pub allowed_programs: [Pubkey; 8], // For ProgramAllowlist
}
