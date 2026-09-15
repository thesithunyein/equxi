use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::EquxiError;

// `ProgramData` comes from the anchor_lang prelude (anchor_lang::ProgramData).
// Do NOT import solana_program::bpf_loader_upgradeable::ProgramData — that is a
// different type with no Anchor `Owner`/`AccountDeserialize` impls, and importing
// it shadows the prelude version.

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
        // The deployer is the upgrade authority and only they may initialize;
        // anyone else could otherwise claim the admin role (which can slash
        // other agents' bonds) before the real operator ever runs initialize.
        //
        // Local tests satisfy this too: Anchor.toml sets [test] upgradeable =
        // true, which makes `anchor test` load the program on the validator
        // with this same wallet as the upgrade authority, exactly like a real
        // `anchor deploy`.
        constraint = program_data.upgrade_authority_address == Some(payer.key())
            @ EquxiError::InvalidAdminAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let vault = &mut ctx.accounts.vault;

    // The signer is proven to be the upgrade authority above, so it is safe to
    // make it the admin. No arbitrary admin can ever be configured.
    config.admin = ctx.accounts.payer.key();
    config.total_agents = 0;
    config.total_bonds = 0;
    config.total_slashed = 0;
    config.bumped = ctx.bumps.config;

    vault.total_slashed = 0;
    vault.total_compensated = 0;
    vault.bumped = ctx.bumps.vault;

    msg!("Equxi initialized. admin = {}", config.admin);
    Ok(())
}
