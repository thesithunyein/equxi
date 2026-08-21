use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
#[instruction(constraint_type: ConstraintType)]
pub struct AddConstraint<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = owner,
        space = 8 + Constraint::INIT_SPACE,
        seeds = [b"constraint", agent.key().as_ref(), (config.total_bonds + 1).to_le_bytes().as_ref()],
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
