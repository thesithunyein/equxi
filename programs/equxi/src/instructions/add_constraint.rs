use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

/// Attaches a behavioral constraint to an agent.
///
/// The constraint PDA is seeded on a **per-agent counter** rather than the global
/// `config.total_bonds`. The old seed meant an agent could only ever hold a single
/// constraint: the second `add_constraint` call derived the same address and `init`
/// failed because the account already existed. Agents can now hold up to
/// `MAX_CONSTRAINTS` rules, which is what the docs always claimed.
#[derive(Accounts)]
pub struct AddConstraint<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Constraint::INIT_SPACE,
        seeds = [b"constraint", agent.key().as_ref(), agent.constraint_count.to_le_bytes().as_ref()],
        bump
    )]
    pub constraint: Account<'info, Constraint>,

    #[account(
        mut,
        has_one = owner @ EquxiError::Unauthorized
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AddConstraint>,
    constraint_type: ConstraintType,
    params: ConstraintParams,
) -> Result<()> {
    let agent = &mut ctx.accounts.agent;

    require!(
        agent.constraint_count < MAX_CONSTRAINTS,
        EquxiError::TooManyConstraints
    );

    let constraint = &mut ctx.accounts.constraint;
    constraint.agent = agent.key();
    constraint.constraint_type = constraint_type;
    constraint.params = params;
    constraint.is_enforced = true;
    constraint.created_at = Clock::get()?.unix_timestamp;
    constraint.bumped = ctx.bumps.constraint;

    agent.constraint_count = agent
        .constraint_count
        .checked_add(1)
        .ok_or(EquxiError::Overflow)?;

    msg!(
        "Constraint {} added to agent {}",
        agent.constraint_count,
        agent.key()
    );
    Ok(())
}
