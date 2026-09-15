use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::EquxiError;

/// Creates a bond for an agent.
///
/// The agent's **owner must sign**. Previously the owner was only checked by
/// address (`address = agent.owner`) without being a signer, which let anyone
/// occupy an agent's one-and-only bond PDA with a dust bond and control its
/// withdrawal. Requiring the signature closes that hole.
#[derive(Accounts)]
pub struct CreateBond<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = owner,
        space = 8 + Bond::INIT_SPACE,
        seeds = [b"bond", agent.key().as_ref()],
        bump
    )]
    pub bond: Account<'info, Bond>,

    #[account(
        mut,
        has_one = owner @ EquxiError::Unauthorized,
        constraint = agent.status == AgentStatus::Active @ EquxiError::AgentNotActive
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateBond>, amount: u64, lock_duration: i64) -> Result<()> {
    require!(amount >= 100_000_000, EquxiError::BondTooSmall);
    require!(lock_duration > 0, EquxiError::InvalidAmount);

    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;
    let bond = &mut ctx.accounts.bond;

    // Transfer SOL to bond PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: bond.to_account_info(),
            },
        ),
        amount,
    )?;

    bond.agent = ctx.accounts.agent.key();
    bond.operator = ctx.accounts.owner.key();
    bond.amount = amount;
    bond.lock_duration = lock_duration;
    bond.locked_at = clock.unix_timestamp;
    bond.expires_at = clock.unix_timestamp + lock_duration;
    bond.is_active = true;
    bond.bumped = ctx.bumps.bond;

    ctx.accounts.agent.bond_address = bond.key();
    config.total_bonds += 1;

    msg!("Bond created: {} lamports locked", amount);
    Ok(())
}
