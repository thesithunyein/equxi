use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

/// Returns the bond to its operator after the lock period, and closes the bond
/// account so no lamports are stranded.
///
/// `close = operator` transfers **all** remaining lamports (rent-exempt deposit
/// plus any un-slashed collateral) back to the operator. Because compensation is
/// now paid out of the escrow vault, `bond.amount` is a faithful record of the
/// collateral still held here, so nothing is left behind in the account.
#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    #[account(
        mut,
        close = operator,
        seeds = [b"bond", agent.key().as_ref()],
        bump = bond.bumped,
        has_one = operator @ EquxiError::Unauthorized,
    )]
    pub bond: Account<'info, Bond>,

    #[account(mut)]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub operator: Signer<'info>,
}

pub fn handler(ctx: Context<WithdrawBond>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= ctx.accounts.bond.expires_at,
        EquxiError::BondNotExpired
    );

    let amount = ctx.accounts.bond.amount;

    // Clear the agent's bond reference so it can bond again.
    ctx.accounts.agent.bond_address = Pubkey::default();

    msg!("Bond closed: {} lamports returned to operator", amount);
    Ok(())
}
