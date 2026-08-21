use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::EquxiError;

#[derive(Accounts)]
pub struct CreateBond<'info> {
    #[account(
        init,
        payer = operator,
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
    pub operator: Signer<'info>,

    #[account(address = agent.owner)]
    /// CHECK: Validated by has_one constraint
    pub owner: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateBond>, amount: u64, lock_duration: i64) -> Result<()> {
    // Minimum bond: 0.1 SOL
    require!(amount >= 100_000_000, EquxiError::BondTooSmall);

    let clock = Clock::get()?;
    let bond = &mut ctx.accounts.bond;

    // Transfer SOL from operator to bond PDA
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

    bond.agent = ctx.accounts.agent.key();
    bond.operator = ctx.accounts.operator.key();
    bond.amount = amount;
    bond.lock_duration = lock_duration;
    bond.locked_at = clock.unix_timestamp;
    bond.expires_at = clock.unix_timestamp + lock_duration;
    bond.is_active = true;
    bond.bumped = ctx.bumps.bond;

    // Update agent's bond address
    ctx.accounts.agent.bond_address = bond.key();

    msg!("Bond created: {} SOL locked for agent", amount);
    Ok(())
}
