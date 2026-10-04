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

/// The whole gate, as a pure function over an explicit `now`.
///
/// The handler is a one-line wrapper around this. Keeping the decision here —
/// rather than inline behind `Clock::get()` — is what lets the unit tests below
/// pin *every* branch, including the one that says yes: a local test validator's
/// clock cannot be moved forward, so the post-window branch is unreachable from
/// an integration test and would otherwise ship untested.
///
/// The two refusals stay distinct so a client can tell "too early" from "past
/// the lock, but still inside the unbonding window".
pub fn ensure_withdrawable(now: i64, expires_at: i64) -> Result<()> {
    if now < expires_at {
        return Err(EquxiError::BondNotExpired.into());
    }
    if now < withdrawable_at(expires_at) {
        return Err(EquxiError::BondInUnbondingPeriod.into());
    }
    Ok(())
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
    ensure_withdrawable(clock.unix_timestamp, ctx.accounts.bond.expires_at)?;

    let amount = ctx.accounts.bond.amount;

    // Clear the agent's bond reference so it can bond again.
    ctx.accounts.agent.bond_address = Pubkey::default();

    msg!("Bond closed: {} lamports returned to operator", amount);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPIRES_AT: i64 = 1_700_000_000;

    /// `AnchorError`'s `PartialEq` compares error code numbers — exactly the
    /// contract a caller sees — so comparing against `Error::from(..)` asserts
    /// the specific refusal, not merely that something failed.
    fn assert_refusal(now: i64, expected: EquxiError) {
        assert_eq!(
            ensure_withdrawable(now, EXPIRES_AT).unwrap_err(),
            Error::from(expected),
            "now={now} (expires_at={EXPIRES_AT}) must be refused"
        );
    }

    #[test]
    fn withdrawable_at_pushes_the_deadline_past_expiry() {
        assert!(withdrawable_at(EXPIRES_AT) > EXPIRES_AT);
        assert_eq!(
            withdrawable_at(EXPIRES_AT),
            EXPIRES_AT + UNBONDING_PERIOD,
            "withdrawable_at must push the deadline past expiry by the whole window"
        );
    }

    #[test]
    fn the_window_is_the_documented_seven_days() {
        assert_eq!(UNBONDING_PERIOD, 604_800);
    }

    /// The race this window exists to close: under the old rule a bond was
    /// withdrawable the moment `now >= expires_at`, so the collateral could be
    /// gone before any post-hoc slash was recorded.
    #[test]
    fn a_bond_cannot_exit_at_the_moment_its_lock_expires() {
        assert_refusal(EXPIRES_AT, EquxiError::BondInUnbondingPeriod);
    }

    #[test]
    fn every_second_of_the_window_is_refused() {
        assert_refusal(EXPIRES_AT - 1, EquxiError::BondNotExpired);
        assert_refusal(EXPIRES_AT + 1, EquxiError::BondInUnbondingPeriod);
        assert_refusal(
            EXPIRES_AT + UNBONDING_PERIOD - 1,
            EquxiError::BondInUnbondingPeriod,
        );
    }

    #[test]
    fn exit_opens_the_second_the_window_closes() {
        assert!(ensure_withdrawable(EXPIRES_AT + UNBONDING_PERIOD, EXPIRES_AT).is_ok());
        assert!(ensure_withdrawable(EXPIRES_AT + UNBONDING_PERIOD + 86_400, EXPIRES_AT).is_ok());
    }

    #[test]
    fn an_absurd_expiry_saturates_instead_of_wrapping() {
        // A wrapping add would land in the past and hand an operator an instant
        // withdrawal — the failure mode must be "never withdrawable", not "now".
        assert_eq!(withdrawable_at(i64::MAX), i64::MAX);
        assert_eq!(
            ensure_withdrawable(i64::MAX - 1, i64::MAX).unwrap_err(),
            Error::from(EquxiError::BondInUnbondingPeriod)
        );
        assert!(ensure_withdrawable(i64::MAX, i64::MAX).is_ok());
    }
}
