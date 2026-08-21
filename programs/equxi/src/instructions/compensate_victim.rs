use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct CompensateVictim<'info> {
    #[account(
        mut,
        seeds = [b"slash", agent.key().as_ref(), slash_record.timestamp.to_le_bytes().as_ref()],
        bump = slash_record.bumped,
        constraint = !slash_record.compensated @ EquxiError::BondInactive
    )]
    pub slash_record: Account<'info, SlashRecord>,

    #[account(
        mut,
        seeds = [b"bond", agent.key().as_ref()],
        bump = bond.bumped
    )]
    pub bond: Account<'info, Bond>,

    #[account(mut)]
    pub agent: Account<'info, Agent>,

    /// CHECK: Victim wallet to receive compensation
    #[account(mut)]
    pub victim: AccountInfo<'info>,

    /// CHECK: Authority that can execute compensation
    #[account(constraint = authority.key() == crate::ID @ EquxiError::SlashingAuthorityRequired)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CompensateVictim>, amount: u64) -> Result<()> {
    let bond = &mut ctx.accounts.bond;
    let slash_record = &mut ctx.accounts.slash_record;

    require!(bond.amount >= amount, EquxiError::InsufficientBond);

    // Transfer compensation from bond to victim
    **bond.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.victim.to_account_info().try_borrow_mut_lamports()? += amount;

    // Mark as compensated
    slash_record.compensated = true;
    slash_record.victim = Some(ctx.accounts.victim.key());

    // Update agent trust score (reduce by 10)
    let agent = &mut ctx.accounts.agent;
    agent.trust_score = agent.trust_score.saturating_sub(10);

    msg!("Compensated {} lamports to victim", amount);
    Ok(())
}
