use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

/// One-time migration: create the escrow vault for a deployment that was
/// initialized before the vault existed (v0.1 config, v0.2 program).
///
/// `initialize` uses `init` on the config PDA, so it can never run again on
/// an existing deployment — without this instruction, upgrading v0.1 ->
/// v0.2 would leave slashes unable to move funds into escrow forever.
///
/// Only the upgrade authority may run it, and it must also be the config's
/// admin, which is exactly who `initialize` appoints.
#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bumped,
        constraint = config.admin == payer.key() @ EquxiError::InvalidAdminAuthority
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ EquxiError::ProgramDataMismatch
    )]
    pub program: Program<'info, crate::program::Equxi>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(payer.key())
            @ EquxiError::InvalidAdminAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.total_slashed = 0;
    vault.total_compensated = 0;
    vault.bumped = ctx.bumps.vault;

    msg!("Equxi escrow vault created by admin {}", ctx.accounts.payer.key());
    Ok(())
}
