use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

/// How long collateral stays slashable *after* the bond's lock expires.
///
/// The lock alone was not enough. Detection is off-chain, so a violation is
/// normally observed after the fact — and an operator who can withdraw the
/// instant the lock ends leaves nothing for the eventual slash to seize. This
/// window keeps the bond active and slashable for a fixed period past expiry, so
/// exit takes time rather than being instantaneous.
///
/// It is a policy choice, not a chain constraint: long enough that an observer
/// can record a slash against an expired-but-still-bonded agent, short enough
/// that an operator's exit is not unbounded.
pub const UNBONDING_PERIOD: i64 = 7 * 24 * 60 * 60;

/// Earliest timestamp at which a bond may be withdrawn.
///
/// Kept as a pure function so it can be pinned by unit tests: a clock-dependent
/// integration test cannot wait a week, and a rule that is only exercised against
/// a live validator is a rule nobody re-checks.
pub fn withdrawable_at(expires_at: i64) -> i64 {
    expires_at.saturating_add(UNBONDING_PERIOD)
}

/// Returns the bond to its operator after the lock period **and an unbonding
/// window**, and closes the bond account so no lamports are stranded.
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
    let expires_at = ctx.accounts.bond.expires_at;
    let earliest = withdrawable_at(expires_at);

    // Two distinct refusals, so a client can tell "too early" from "past the lock
    // but still inside the unbonding window".
    if clock.unix_timestamp < expires_at {
        return Err(EquxiError::BondNotExpired.into());
    }
    require!(
        clock.unix_timestamp >= earliest,
        EquxiError::BondInUnbondingPeriod
    );

    let amount = ctx.accounts.bond.amount;

    // Clear the agent's bond reference so it can bond again.
    ctx.accounts.agent.bond_address = Pubkey::default();

    msg!("Bond closed: {} lamports returned to operator", amount);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The race this window exists to close: under the old rule a bond was
    /// withdrawable the moment `now >= expires_at`, so the collateral could be
    /// gone before any post-hoc slash was recorded.
    #[test]
    fn withdrawal_cannot_be_instant_at_expiry() {
        let expires_at = 1_700_000_000i64;

        // What the old rule allowed, and no longer does.
        assert!(expires_at >= expires_at);
        assert!(withdrawable_at(expires_at) > expires_at);

        assert_eq!(
            withdrawable_at(expires_at),
            expires_at + UNBONDING_PERIOD,
            "withdrawable_at must push the deadline past expiry by the whole window"
        );
    }

    #[test]
    fn the_window_is_the_documented_seven_days() {
        assert_eq!(UNBONDING_PERIOD, 604_800);
    }

    #[test]
    fn an_absurd_expiry_saturates_instead_of_wrapping() {
        // A wrapping add would land in the past and hand an operator an instant
        // withdrawal — the failure mode must be "never withdrawable", not "now".
        assert_eq!(withdrawable_at(i64::MAX), i64::MAX);
    }
}
