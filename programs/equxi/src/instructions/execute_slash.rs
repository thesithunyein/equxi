use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct ExecuteSlash<'info> {
    #[account(
        mut,
        has_one = owner @ EquxiError::Unauthorized,
        constraint = agent.status == AgentStatus::Active @ EquxiError::AgentNotActive
    )]
    pub agent: Account<'info, Agent>,

    #[account(
        mut,
        has_one = agent,
        constraint = bond.is_active @ EquxiError::BondInactive
    )]
    pub bond: Account<'info, Bond>,

    #[account(
        mut,
        seeds = [b"slash", agent.key().as_ref(), Clock::get()?.unix_timestamp.to_le_bytes().as_ref()],
        bump
    )]
    pub slash_record: Account<'info, SlashRecord>,

    #[account(address = agent.owner)]
    /// CHECK: Validated by has_one constraint
    pub owner: AccountInfo<'info>,

    /// CHECK: Authority that can execute slashes (program admin)
    #[account(constraint = authority.key() == crate::ID @ EquxiError::SlashingAuthorityRequired)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteSlash>, reason: String, slash_amount: u64) -> Result<()> {
    let bond = &mut ctx.accounts.bond;
    let agent = &mut ctx.accounts.agent;
    let slash_record = &mut ctx.accounts.slash_record;
    let clock = Clock::get()?;

    // Check sufficient bond
    require!(bond.amount >= slash_amount, EquxiError::InsufficientBond);

    // Execute the slash
    bond.amount = bond.amount.checked_sub(slash_amount)
        .ok_or(EquxiError::Overflow)?;

    // Update agent status
    if bond.amount == 0 {
        agent.status = AgentStatus::Slashed;
        bond.is_active = false;
    }

    // Record the slash
    let reason_bytes = reason.as_bytes();
    let mut reason_fixed = [0u8; 128];
    reason_fixed[..reason_bytes.len().min(128)].copy_from_slice(&reason_bytes[..reason_bytes.len().min(128)]);

    slash_record.agent = agent.key();
    slash_record.authority = ctx.accounts.authority.key();
    slash_record.amount = slash_amount;
    slash_record.reason = reason_fixed;
    slash_record.timestamp = clock.unix_timestamp;
    slash_record.victim = None;
    slash_record.compensated = false;

    // Transfer slashed SOL to authority (treasury)
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += slash_amount;
    **bond.to_account_info().try_borrow_mut_lamports()? -= slash_amount;

    msg!("Slashed {} lamports from agent bond", slash_amount);
    Ok(())
}
