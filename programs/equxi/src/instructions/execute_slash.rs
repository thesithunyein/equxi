use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

/// Seizes collateral from a bond and moves it into the program-owned escrow vault.
///
/// The slashed lamports are **not** sent to the admin. They land in the `vault`
/// PDA, where `compensate_victim` can pay them to the injured party. This is what
/// makes the protocol non-custodial with respect to slashed funds.
#[derive(Accounts)]
pub struct ExecuteSlash<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault.bumped,
    )]
    pub vault: Account<'info, Vault>,

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
        init_if_needed,
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
    let clock = Clock::get()?;

    require!(slash_amount > 0, EquxiError::InvalidAmount);
    require!(
        ctx.accounts.bond.amount >= slash_amount,
        EquxiError::InsufficientBond
    );

    let nonce = ctx.accounts.config.total_slashed;

    // Move slashed collateral: bond -> escrow vault. The admin takes no custody.
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? += slash_amount;
    **ctx.accounts.bond.to_account_info().try_borrow_mut_lamports()? -= slash_amount;

    // Record the slash
    let reason_bytes = reason.as_bytes();
    let mut reason_fixed = [0u8; 128];
    let copy_len = reason_bytes.len().min(128);
    reason_fixed[..copy_len].copy_from_slice(&reason_bytes[..copy_len]);

    let slash_record = &mut ctx.accounts.slash_record;
    slash_record.agent = ctx.accounts.agent.key();
    slash_record.authority = ctx.accounts.authority.key();
    slash_record.amount = slash_amount;
    slash_record.reason = reason_fixed;
    slash_record.nonce = nonce;
    slash_record.timestamp = clock.unix_timestamp;
    slash_record.victim = None;
    slash_record.compensated = false;
    slash_record.bumped = ctx.bumps.slash_record;

    // Reduce the recorded collateral and update status if fully drained.
    let bond = &mut ctx.accounts.bond;
    bond.amount = bond
        .amount
        .checked_sub(slash_amount)
        .ok_or(EquxiError::Overflow)?;

    let agent = &mut ctx.accounts.agent;
    if bond.amount == 0 {
        agent.status = AgentStatus::Slashed;
        bond.is_active = false;
    }

    // Track escrow totals so the vault can never be over-drawn.
    let vault = &mut ctx.accounts.vault;
    vault.total_slashed = vault
        .total_slashed
        .checked_add(slash_amount)
        .ok_or(EquxiError::Overflow)?;

    ctx.accounts.config.total_slashed = nonce.checked_add(1).ok_or(EquxiError::Overflow)?;

    msg!(
        "Slashed {} lamports into escrow (record #{})",
        slash_amount,
        nonce
    );
    Ok(())
}
