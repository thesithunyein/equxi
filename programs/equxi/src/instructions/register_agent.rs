use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
#[instruction(name: String, agent_type: AgentType)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = operator,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", operator.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterAgent>, name: String, agent_type: AgentType) -> Result<()> {
    require!(name.len() <= 32, EquxiError::NameTooLong);

    let agent = &mut ctx.accounts.agent;
    let name_bytes = name.as_bytes();
    let mut name_fixed = [0u8; 32];
    name_fixed[..name_bytes.len()].copy_from_slice(name_bytes);

    agent.owner = ctx.accounts.operator.key();
    agent.name = name_fixed;
    agent.agent_type = agent_type;
    agent.trust_score = 50; // Default starting trust score
    agent.status = AgentStatus::Active;
    agent.bond_address = Pubkey::default(); // Will be set when bond is created
    agent.created_at = Clock::get()?.unix_timestamp;
    agent.bumped = ctx.bumps.agent;

    msg!("Agent registered: {}", name);
    Ok(())
}
