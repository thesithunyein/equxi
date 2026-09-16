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
/// Either the config's admin or the program's upgrade authority may run it.
///
/// Requiring *both* was the original rule, and it is unrunnable on exactly the
/// deployment this instruction exists for: a live v0.1 config records whatever
/// admin wallet `initialize` was given (on devnet, the operator's Phantom),
/// while the upgrade authority is a different key entirely. A guard that no key
/// can satisfy is not a guard, it is a dead end — and the alternative to
/// creating the vault is that slashed collateral can never be escrowed on a
/// live deployment.
///
/// Admitting the upgrade authority adds no real privilege: it can already
/// replace this program's code outright.
#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bumped,
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

    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateVault>) -> Result<()> {
    let payer = ctx.accounts.payer.key();
    let is_config_admin = ctx.accounts.config.admin == payer;
    let is_upgrade_authority =
        ctx.accounts.program_data.upgrade_authority_address == Some(payer);
    require!(
        is_config_admin || is_upgrade_authority,
        EquxiError::InvalidAdminAuthority
    );

    let vault = &mut ctx.accounts.vault;
    vault.total_slashed = 0;
    vault.total_compensated = 0;
    vault.bumped = ctx.bumps.vault;

    msg!("Equxi escrow vault created by admin {}", ctx.accounts.payer.key());
    Ok(())
}
