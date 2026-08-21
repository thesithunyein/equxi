use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod error;

use instructions::*;
use state::*;

declare_id!("9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ");

#[program]
pub mod equxi {
    use super::*;

    /// Initialize the program with an admin authority
    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, admin)
    }

    /// Register a new AI agent
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        agent_type: AgentType,
    ) -> Result<()> {
        instructions::register_agent::handler(ctx, name, agent_type)
    }

    /// Create a bond (lock SOL collateral)
    pub fn create_bond(
        ctx: Context<CreateBond>,
        amount: u64,
        lock_duration: i64,
    ) -> Result<()> {
        instructions::create_bond::handler(ctx, amount, lock_duration)
    }

    /// Withdraw bond after lock period expires
    pub fn withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
        instructions::withdraw_bond::handler(ctx)
    }

    /// Add a behavioral constraint
    pub fn add_constraint(
        ctx: Context<AddConstraint>,
        constraint_type: ConstraintType,
        params: ConstraintParams,
    ) -> Result<()> {
        instructions::add_constraint::handler(ctx, constraint_type, params)
    }

    /// Execute slashing (admin only)
    pub fn execute_slash(
        ctx: Context<ExecuteSlash>,
        reason: String,
        slash_amount: u64,
    ) -> Result<()> {
        instructions::execute_slash::handler(ctx, reason, slash_amount)
    }

    /// Compensate a victim from slashed funds
    pub fn compensate_victim(
        ctx: Context<CompensateVictim>,
        amount: u64,
    ) -> Result<()> {
        instructions::compensate_victim::handler(ctx, amount)
    }

    /// Update trust score (admin only)
    pub fn update_trust_score(
        ctx: Context<UpdateTrustScore>,
        score: u8,
    ) -> Result<()> {
        instructions::update_trust_score::handler(ctx, score)
    }
}
