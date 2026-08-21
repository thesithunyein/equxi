use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
#[instruction(constraint_type: ConstraintType)]
pub struct AddConstraint<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Constraint::INIT_SPACE,
        seeds = [b"constraint", agent.key().as_ref(), &constraint_type.clone() as &[u8]],
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
    let constraint = &mut ctx.accounts.constraint;

    constraint.agent = ctx.accounts.agent.key();
    constraint.constraint_type = constraint_type;
    constraint.params = params;
    constraint.is_enforced = true;
    constraint.created_at = Clock::get()?.unix_timestamp;
    constraint.bumped = ctx.bumps.constraint;

    msg!("Constraint added: {:?}", constraint_type);
    Ok(())
}
