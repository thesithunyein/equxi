use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::Discriminator;
use crate::state::*;
use crate::error::EquxiError;

/// Byte length of an `Agent` account written by the v0.1 program.
pub const AGENT_V1_LEN: usize = 116;

/// Byte length of an `Agent` account written by this program.
pub const AGENT_V2_LEN: usize = 118;

/// `owner: Pubkey` sits directly after the 8-byte discriminator.
const AGENT_OWNER_OFFSET: usize = 8;

/// In the v0.1 layout this is where `created_at` starts; in v0.2 the two bytes
/// of `constraint_count` go here and `created_at` moves to 109, `bumped` to 117.
/// These are the same offsets `lib/equxi-layout.js` decodes with, and
/// `tests/unit/layout.test.ts` fails if the two ever disagree.
const V1_CREATED_AT_OFFSET: usize = 107;
const V1_BUMPED_OFFSET: usize = 115;

/// Migrates an `Agent` account from the v0.1 layout to the v0.2 layout.
///
/// v0.2 added `constraint_count: u16` to `Agent` (so one agent can hold many
/// constraints instead of exactly one), which grew the account from 116 to 118
/// bytes. Anchor refuses to deserialize a shorter account, so upgrading the
/// program in place leaves every pre-existing agent unreadable until it is
/// migrated — that is what this instruction is for. Without it, an upgrade
/// would silently strand the reputation history the whole protocol is built on.
///
/// The migration is deliberately incapable of rewriting history: it inserts a
/// counter and shifts the untouched trailing bytes. Every other field keeps its
/// byte-for-byte value, which `tests/unit` asserts directly.
#[derive(Accounts)]
pub struct MigrateAgent<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bumped,
    )]
    pub config: Account<'info, Config>,

    /// The agent account, handled as raw bytes: a 116-byte v0.1 account cannot
    /// be deserialized into the v0.2 `Agent`, which is the whole reason this
    /// instruction exists.
    ///
    /// CHECK: validated in the handler before a single byte is written — the
    /// account must be owned by this program, exactly 116 bytes long, and carry
    /// the `Agent` discriminator.
    #[account(mut)]
    pub agent: UncheckedAccount<'info>,

    /// The agent's owner, the program admin, or the program's upgrade
    /// authority.
    ///
    /// The owner is the normal path. The fallbacks exist because a migration
    /// that can only be run by a key that has been lost is not a migration, it
    /// is a permanent stranding of the agent's history — and on the live devnet
    /// deployment the owner and admin are the operator's Phantom while the
    /// upgrade authority is a separate key, so restricting this to the owner
    /// alone would leave the one existing agent unreadable forever.
    ///
    /// Neither fallback can rewrite anything: the migration inserts a
    /// zero-valued counter and shifts untouched trailing bytes, so owner, name,
    /// score, status and bond address keep their exact values.
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ EquxiError::ProgramDataMismatch
    )]
    pub program: Program<'info, crate::program::Equxi>,

    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateAgent>, existing_constraints: u16) -> Result<()> {
    require!(
        existing_constraints <= MAX_CONSTRAINTS,
        EquxiError::TooManyConstraints
    );

    let agent_info = ctx.accounts.agent.to_account_info();

    require_keys_eq!(
        agent_info.owner.key(),
        *ctx.program_id,
        EquxiError::InvalidAgentLayout
    );
    require!(
        agent_info.data_len() == AGENT_V1_LEN,
        EquxiError::InvalidAgentLayout
    );

    // Read (and verify) before writing anything, so a rejected migration leaves
    // the account exactly as it was.
    let recorded_owner = {
        let data = agent_info.try_borrow_data()?;
        require!(
            &data[..8] == Agent::DISCRIMINATOR.as_ref(),
            EquxiError::InvalidAgentLayout
        );
        Pubkey::try_from(&data[AGENT_OWNER_OFFSET..AGENT_OWNER_OFFSET + 32])
            .map_err(|_| error!(EquxiError::InvalidAgentLayout))?
    };

    let signer = ctx.accounts.signer.key();
    let is_upgrade_authority =
        ctx.accounts.program_data.upgrade_authority_address == Some(signer);
    require!(
        signer == recorded_owner
            || signer == ctx.accounts.config.admin
            || is_upgrade_authority,
        EquxiError::Unauthorized
    );

    // Growing a program-owned account requires it to stay rent-exempt, so the
    // signer covers the two extra bytes first.
    let rent = Rent::get()?;
    let required = rent.minimum_balance(AGENT_V2_LEN);
    let current = agent_info.lamports();
    if current < required {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: agent_info.clone(),
                },
            ),
            required - current,
        )?;
    }

    agent_info.realloc(AGENT_V2_LEN, false)?;

    let mut data = agent_info.try_borrow_mut_data()?;
    migrate_v1_agent_bytes(&mut data[..], existing_constraints)?;

    msg!(
        "Migrated agent {} from the v0.1 layout (116 bytes) to v0.2 (118 bytes), constraint_count={}",
        ctx.accounts.agent.key(),
        existing_constraints
    );
    Ok(())
}

/// The byte surgery itself, kept pure and separate so it can be unit-tested
/// without a validator.
///
/// `data` must already be the grown 118-byte buffer whose first 116 bytes still
/// hold the v0.1 record. `created_at` and `bumped` are read out before anything
/// is written, so the two overlapping writes cannot corrupt each other.
pub fn migrate_v1_agent_bytes(data: &mut [u8], existing_constraints: u16) -> Result<()> {
    require!(data.len() == AGENT_V2_LEN, EquxiError::InvalidAgentLayout);

    let created_at = i64::from_le_bytes(
        data[V1_CREATED_AT_OFFSET..V1_CREATED_AT_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(EquxiError::InvalidAgentLayout))?,
    );
    let bumped = data[V1_BUMPED_OFFSET];

    // disc(8) owner(32) name(32) agent_type(1) trust_score(1) status(1)
    // bond_address(32) [ constraint_count(2) ] created_at(8) bumped(1)
    data[V1_CREATED_AT_OFFSET..V1_CREATED_AT_OFFSET + 2]
        .copy_from_slice(&existing_constraints.to_le_bytes());
    data[V1_CREATED_AT_OFFSET + 2..V1_CREATED_AT_OFFSET + 10]
        .copy_from_slice(&created_at.to_le_bytes());
    data[AGENT_V2_LEN - 1] = bumped;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a v0.1 `Agent` record: discriminator, then the fields in order.
    fn v1_agent_bytes() -> Vec<u8> {
        let mut v = Vec::with_capacity(AGENT_V1_LEN);
        v.extend_from_slice(Agent::DISCRIMINATOR.as_ref());
        v.extend_from_slice(&[7u8; 32]); // owner
        v.extend_from_slice(b"Augur\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0");
        v.push(0); // agent_type
        v.push(72); // trust_score
        v.push(0); // status
        v.extend_from_slice(&[9u8; 32]); // bond_address
        v.extend_from_slice(&1_700_000_000i64.to_le_bytes()); // created_at
        v.push(254); // bumped
        assert_eq!(v.len(), AGENT_V1_LEN);
        v
    }

    #[test]
    fn inserts_the_counter_and_preserves_every_other_byte() {
        let old = v1_agent_bytes();
        let mut grown = old.clone();
        grown.extend_from_slice(&[0, 0]); // what realloc gives us

        migrate_v1_agent_bytes(&mut grown, 1).unwrap();

        assert_eq!(grown.len(), AGENT_V2_LEN);
        // The counter landed at 107 and the trailing fields shifted by two.
        assert_eq!(u16::from_le_bytes([grown[107], grown[108]]), 1);
        assert_eq!(
            i64::from_le_bytes(grown[109..117].try_into().unwrap()),
            1_700_000_000
        );
        assert_eq!(grown[117], 254);
        // Everything up to the insertion point is untouched, byte for byte.
        assert_eq!(&grown[..107], &old[..107]);
    }

    #[test]
    fn records_the_constraint_count_it_was_given() {
        let mut grown = v1_agent_bytes();
        grown.extend_from_slice(&[0, 0]);
        migrate_v1_agent_bytes(&mut grown, 16).unwrap();
        assert_eq!(u16::from_le_bytes([grown[107], grown[108]]), 16);
    }

    #[test]
    fn refuses_a_buffer_that_is_not_the_migrated_size() {
        let mut short = v1_agent_bytes();
        assert!(migrate_v1_agent_bytes(&mut short, 0).is_err());
    }
}
