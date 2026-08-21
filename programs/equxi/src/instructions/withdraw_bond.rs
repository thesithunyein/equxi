use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    #[account(
        mut,
        seeds = [b"bond", agent.key().as_ref()],
        bump = bond.bumped,
        has_one = operator @ EquxiError::Unauthorized,
        constraint = bond.is_active @ EquxiError::BondInactive,
    )]
    pub bond: Account<'info, Bond>,

    #[account(mut)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawBond>) -> Result<()> {
    let bond = &mut ctx.accounts.bond;
    let clock = Clock::get()?;

    // Check lock period has expired
    require!(clock.unix_timestamp >= bond.expires_at, EquxiError::BondNotExpired);

    let amount = bond.amount;

    // Transfer SOL back to operator
    **ctx.accounts.operator.to_account_info().try_borrow_mut_lamports()? += amount;
    **bond.to_account_info().try_borrow_mut_lamports()? -= amount;

    // Mark bond as inactive
    bond.amount = 0;
    bond.is_active = false;

    // Clear agent's bond reference
    ctx.accounts.agent.bond_address = Pubkey::default();

    msg!("Bond withdrawn: {} SOL returned to operator", amount);
    Ok(())
}
