use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

/// Pays a victim out of the escrow vault.
///
/// Two bugs are fixed here relative to the previous implementation:
///
/// 1. Compensation used to be drawn from the **admin's wallet** while the bond's
///    recorded `amount` was decremented anyway. That desynchronised
///    `bond.amount` from the real balance, and `withdraw_bond` would then pay out
///    the recorded amount, permanently stranding the difference in the PDA.
///    Funds now come from the vault, and `bond.amount` is left untouched.
/// 2. The slash amount is now enforced as a ceiling, so a slash can never be
///    "compensated" for more than was actually seized.
#[derive(Accounts)]
pub struct CompensateVictim<'info> {
    #[account(
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
        seeds = [b"slash", agent.key().as_ref(), slash_record.nonce.to_le_bytes().as_ref()],
        bump = slash_record.bumped,
        constraint = !slash_record.compensated @ EquxiError::AlreadyCompensated
    )]
    pub slash_record: Account<'info, SlashRecord>,

    #[account(mut)]
    pub agent: Account<'info, Agent>,

    /// CHECK: Victim wallet receiving compensation
    #[account(mut)]
    pub victim: AccountInfo<'info>,

    #[account(constraint = authority.key() == config.admin @ EquxiError::SlashingAuthorityRequired)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CompensateVictim>, amount: u64) -> Result<()> {
    require!(amount > 0, EquxiError::InvalidAmount);
    require!(
        amount <= ctx.accounts.slash_record.amount,
        EquxiError::ExceedsSlashAmount
    );
    require!(
        amount <= ctx.accounts.vault.available(),
        EquxiError::VaultInsufficient
    );

    // Move lamports: escrow vault -> victim.
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.victim.to_account_info().try_borrow_mut_lamports()? += amount;

    // Record the payout. `bond.amount` is deliberately NOT touched — the collateral
    // already left the bond when it was slashed.
    let vault = &mut ctx.accounts.vault;
    vault.total_compensated = vault
        .total_compensated
        .checked_add(amount)
        .ok_or(EquxiError::Overflow)?;

    let slash_record = &mut ctx.accounts.slash_record;
    slash_record.compensated = true;
    slash_record.victim = Some(ctx.accounts.victim.key());

    // Slashing costs the agent reputation.
    let agent = &mut ctx.accounts.agent;
    agent.trust_score = agent.trust_score.saturating_sub(10);

    msg!("Compensated {} lamports to victim from escrow", amount);
    Ok(())
}
