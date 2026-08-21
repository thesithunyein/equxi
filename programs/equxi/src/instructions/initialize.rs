use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = admin;
    config.total_agents = 0;
    config.total_bonds = 0;
    config.total_slashed = 0;
    config.bumped = ctx.bumps.config;
    msg!("Equxi initialized with admin: {}", admin);
    Ok(())
}
