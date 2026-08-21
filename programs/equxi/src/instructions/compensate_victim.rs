use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct CompensateVictim<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"slash", agent.key().as_ref(), slash_record.nonce.to_le_bytes().as_ref()],
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

    /// CHECK: Victim wallet
    #[account(mut)]
    pub victim: AccountInfo<'info>,

    #[account(constraint = authority.key() == config.admin @ EquxiError::SlashingAuthorityRequired)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CompensateVictim>, amount: u64) -> Result<()> {
    // Read lamport balance BEFORE mutable borrows
    let current_balance = ctx.accounts.bond.to_account_info().lamports();
    require!(current_balance >= amount, EquxiError::InsufficientBond);

    // Transfer compensation: admin pays victim directly
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.victim.to_account_info().try_borrow_mut_lamports()? += amount;

    // Update stored state
    let bond = &mut ctx.accounts.bond;
    bond.amount = bond.amount.saturating_sub(amount);

    let slash_record = &mut ctx.accounts.slash_record;
    slash_record.compensated = true;
    slash_record.victim = Some(ctx.accounts.victim.key());

    // Reduce trust score
    let agent = &mut ctx.accounts.agent;
    agent.trust_score = agent.trust_score.saturating_sub(10);

    msg!("Compensated {} lamports to victim", amount);
    Ok(())
}
