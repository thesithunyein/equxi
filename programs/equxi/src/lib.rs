use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod error;

use instructions::*;
use state::*;

declare_id!("EQUxi11111111111111111111111111111111111111111");

#[program]
pub mod equxi {
    use super::*;

    /// Register a new AI agent with an operator wallet
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        agent_type: AgentType,
    ) -> Result<()> {
        instructions::register_agent::handler(ctx, name, agent_type)
    }

    /// Create a bond (lock SOL collateral) for an agent
    pub fn create_bond(
        ctx: Context<CreateBond>,
        amount: u64,
        lock_duration: i64,
    ) -> Result<()> {
        instructions::create_bond::handler(ctx, amount, lock_duration)
    }

    /// Add a behavioral constraint to an agent
    pub fn add_constraint(
        ctx: Context<AddConstraint>,
        constraint_type: ConstraintType,
        params: ConstraintParams,
    ) -> Result<()> {
        instructions::add_constraint::handler(ctx, constraint_type, params)
    }

    /// Execute slashing against an agent's bond
    pub fn execute_slash(
        ctx: Context<ExecuteSlash>,
        reason: String,
        slash_amount: u64,
    ) -> Result<()> {
        instructions::execute_slash::handler(ctx, reason, slash_amount)
    }

    /// Compensate a victim from a slashed bond
    pub fn compensate_victim(
        ctx: Context<CompensateVictim>,
        amount: u64,
    ) -> Result<()> {
        instructions::compensate_victim::handler(ctx, amount)
    }

    /// Update agent trust score (called by oracle)
    pub fn update_trust_score(
        ctx: Context<UpdateTrustScore>,
        score: u8,
    ) -> Result<()> {
        instructions::update_trust_score::handler(ctx, score)
    }
}
