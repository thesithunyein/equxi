use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::EquxiError;

/// Records a later deposit into an existing bond's ledger.
///
/// `create_bond` was the only door collateral could enter through, so lamports
/// added afterwards — topping a bond up toward a higher collateral target, or
/// proceeds that arrive after the bond is already open — either had to be sent
/// to the raw bond account (where `bond.amount` never learned about them, so the
/// ledger and the read API understated the collateral) or not added at all. This
/// instruction moves the lamports and updates the recorded amount in one step.
///
/// The signer must be the bond's operator — the same authority that created it
/// and that `withdraw_bond` returns the collateral to. A top-up only makes the
/// collateral larger, so it is allowed while the bond is active, including after
/// the lock expires but before the unbonding window closes. Nothing here is an
/// exit path: topped-up lamports are withdrawable and slashable exactly like the
/// original collateral.
#[derive(Accounts)]
pub struct TopUpBond<'info> {
    #[account(
        mut,
        seeds = [b"bond", agent.key().as_ref()],
        bump = bond.bumped,
        has_one = operator @ EquxiError::Unauthorized,
        constraint = bond.is_active @ EquxiError::BondInactive,
    )]
    pub bond: Account<'info, Bond>,

    /// The agent the bond belongs to. Read-only: it is the seed that derives the
    /// bond PDA, and the stored back-reference must agree, so a top-up can never
    /// be recorded against a bond the agent has stopped pointing at.
    #[account(
        constraint = agent.bond_address == bond.key() @ EquxiError::Unauthorized,
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Rejects a zero-amount top-up, which would otherwise be a paid transaction
/// that records nothing.
pub fn ensure_top_up(amount: u64) -> Result<()> {
    require!(amount > 0, EquxiError::InvalidAmount);
    Ok(())
}

/// The recorded collateral after a top-up.
///
/// Kept as a pure function, like the unbonding gate, so the arithmetic can be
/// pinned by unit tests: the only acceptable failure mode on overflow is a
/// refusal, never a wrapped total that understates what the bond actually holds.
pub fn topped_up_amount(current: u64, top_up: u64) -> Result<u64> {
    current
        .checked_add(top_up)
        .ok_or_else(|| EquxiError::Overflow.into())
}

pub fn handler(ctx: Context<TopUpBond>, amount: u64) -> Result<()> {
    ensure_top_up(amount)?;

    let bond = &mut ctx.accounts.bond;
    let new_amount = topped_up_amount(bond.amount, amount)?;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.operator.to_account_info(),
                to: bond.to_account_info(),
            },
        ),
        amount,
    )?;

    bond.amount = new_amount;

    msg!(
        "Bond topped up: +{} lamports recorded (total {})",
        amount,
        new_amount
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_refusal(amount: u64, expected: EquxiError) {
        assert_eq!(
            ensure_top_up(amount).unwrap_err(),
            Error::from(expected),
            "amount={amount} must be refused"
        );
    }

    #[test]
    fn a_zero_top_up_is_refused_and_one_lamport_is_accepted() {
        assert_refusal(0, EquxiError::InvalidAmount);
        assert!(ensure_top_up(1).is_ok());
    }

    #[test]
    fn a_top_up_is_added_to_the_recorded_amount() {
        assert_eq!(topped_up_amount(100, 50).unwrap(), 150);
        assert_eq!(topped_up_amount(0, 100_000_000).unwrap(), 100_000_000);
    }

    #[test]
    fn the_recorded_amount_can_reach_the_lamport_maximum_but_never_wrap() {
        // A wrapped add would understate the collateral in the program's own
        // ledger, which is the one number every reader trusts.
        assert_eq!(topped_up_amount(u64::MAX - 1, 1).unwrap(), u64::MAX);
        assert_eq!(
            topped_up_amount(u64::MAX, 1).unwrap_err(),
            Error::from(EquxiError::Overflow)
        );
        assert_eq!(
            topped_up_amount(u64::MAX, u64::MAX).unwrap_err(),
            Error::from(EquxiError::Overflow)
        );
    }
}
