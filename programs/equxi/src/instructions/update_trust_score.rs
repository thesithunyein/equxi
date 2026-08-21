use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct UpdateTrustScore<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub agent: Account<'info, Agent>,

    #[account(constraint = authority.key() == config.admin @ EquxiError::SlashingAuthorityRequired)]
    pub authority: Signer<'info>,
}

pub fn handler(_ctx: Context<UpdateTrustScore>, score: u8) -> Result<()> {
    require!(score <= 100, EquxiError::InvalidTrustScore);
    let agent = &mut _ctx.accounts.agent;
    agent.trust_score = score;
    msg!("Trust score updated to {}", score);
    Ok(())
}
