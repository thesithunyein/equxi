use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct ExecuteSlash<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
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
        init,
        payer = authority,
        space = 8 + SlashRecord::INIT_SPACE,
        seeds = [b"slash", agent.key().as_ref(), config.total_slashed.to_le_bytes().as_ref()],
        bump
    )]
    pub slash_record: Account<'info, SlashRecord>,

    #[account(mut, constraint = authority.key() == config.admin @ EquxiError::SlashingAuthorityRequired)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteSlash>, reason: String, slash_amount: u64) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let bond = &mut ctx.accounts.bond;
    let agent = &mut ctx.accounts.agent;
    let slash_record = &mut ctx.accounts.slash_record;
    let clock = Clock::get()?;

    require!(bond.amount >= slash_amount, EquxiError::InsufficientBond);

    // Execute slash
    bond.amount = bond.amount.checked_sub(slash_amount)
        .ok_or(EquxiError::Overflow)?;

    if bond.amount == 0 {
        agent.status = AgentStatus::Slashed;
        bond.is_active = false;
    }

    // Record with nonce
    let reason_bytes = reason.as_bytes();
    let mut reason_fixed = [0u8; 128];
    let copy_len = reason_bytes.len().min(128);
    reason_fixed[..copy_len].copy_from_slice(&reason_bytes[..copy_len]);

    slash_record.agent = agent.key();
    slash_record.authority = ctx.accounts.authority.key();
    slash_record.amount = slash_amount;
    slash_record.reason = reason_fixed;
    slash_record.nonce = config.total_slashed;
    slash_record.timestamp = clock.unix_timestamp;
    slash_record.victim = None;
    slash_record.compensated = false;
    slash_record.bumped = ctx.bumps.slash_record;

    // Transfer to admin (treasury)
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += slash_amount;
    **bond.to_account_info().try_borrow_mut_lamports()? -= slash_amount;

    config.total_slashed += 1;

    msg!("Slashed {} lamports from bond (record #{})", slash_amount, config.total_slashed - 1);
    Ok(())
}
