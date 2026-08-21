use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct UpdateTrustScore<'info> {
    #[account(mut)]
    pub agent: Account<'info, Agent>,

    /// CHECK: Oracle that updates trust scores
    #[account(constraint = oracle.key() == crate::ID @ EquxiError::SlashingAuthorityRequired)]
    pub oracle: Signer<'info>,
}

pub fn handler(_ctx: Context<UpdateTrustScore>, score: u8) -> Result<()> {
    require!(score <= 100, EquxiError::InvalidTrustScore);

    let agent = &mut _ctx.accounts.agent;
    agent.trust_score = score;

    msg!("Trust score updated to {}", score);
    Ok(())
}
