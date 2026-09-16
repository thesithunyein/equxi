#!/usr/bin/env node
/**
 * Bring an already-deployed equxi program up to v0.2 without losing what is
 * already on chain.
 *
 * Running the v0.2 program is only half a migration. Two things can be missing
 * on a deployment that predates it, and neither is fixed by deploying code:
 *
 *   1. the escrow vault, which v0.1 never created, so `execute_slash` has
 *      nowhere legal to move seized collateral; and
 *   2. the `Agent` accounts themselves — v0.2 added `constraint_count: u16`,
 *      growing them from 116 to 118 bytes, and Anchor refuses to deserialize a
 *      shorter account. Until each one is grown in place it is unreadable *by
 *      the program*, so every instruction touching that agent fails.
 *
 * This script does both, and refuses to guess. Before it migrates an agent it
 * decodes the account with the same decoder the website uses, and after the
 * migration it decodes again and asserts that every field it could not legally
 * change is byte-for-byte what it was. A migration that silently rewrote a
 * reputation record would be worse than no migration at all.
 *
 * The instructions are built here rather than through `@coral-xyz/anchor`'s
 * `Program`, deliberately. The account privileges in `sdk/src/idl/equxi.json`
 * are not honoured by every Anchor client version, and a privilege that is
 * silently dropped ('writable privilege escalated') fails at the worst possible
 * moment — half way through a migration. Deriving the discriminator from the
 * instruction name and stating every account flag explicitly removes that
 * dependency: the bytes on the wire are exactly what is written here.
 *
 * Usage:
 *   node migrate.js                 # do it (devnet)
 *   node migrate.js --dry-run       # report what would change, send nothing
 *
 * Environment:
 *   EQUXI_RPC      RPC endpoint          (default https://api.devnet.solana.com)
 *   EQUXI_KEYPAIR  authority keypair     (default ~/.config/solana/id.json)
 *
 * Safe to run twice: a vault that exists is left alone, and an agent that is
 * already 118 bytes is reported as up to date rather than re-migrated.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");

const layout = require("./lib/equxi-layout.js");

const RPC = process.env.EQUXI_RPC || "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.EQUXI_KEYPAIR || path.join(os.homedir(), ".config/solana/id.json");
const DRY_RUN = process.argv.includes("--dry-run");

const PROGRAM_ID = new PublicKey(layout.PROGRAM_ID);
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/** Fields a migration must never be able to change. */
const PRESERVED_AGENT_FIELDS = [
  "owner",
  "name",
  "agentType",
  "trustScore",
  "status",
  "statusCode",
  "bondAddress",
  "createdAt",
];

/**
 * Anchor's instruction discriminator: the first 8 bytes of
 * `sha256("global:" + snake_case_name)`. Derived here rather than copied so a
 * renamed instruction can never silently point at the wrong one.
 */
function discriminator(snakeName) {
  return crypto
    .createHash("sha256")
    .update(`global:${snakeName}`)
    .digest()
    .subarray(0, 8);
}

function loadKeypair(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `No keypair at ${file}. Set EQUXI_KEYPAIR to the file that holds the ` +
        `upgrade authority or the config admin.`
    );
  }
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(file, "utf8")))
  );
}

async function send(connection, instruction, signers) {
  const tx = new Transaction().add(instruction);
  const latest = await connection.getLatestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
}

function createVaultInstruction(accounts) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      // Writable even though the handler only reads it: Anchor enforces a
      // field's `mut` at deserialization (ConstraintMut), not at write time, so
      // a read-only config is rejected before the instruction body runs.
      { pubkey: accounts.config, isSigner: false, isWritable: true },
      { pubkey: accounts.vault, isSigner: false, isWritable: true },
      { pubkey: accounts.payer, isSigner: true, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: accounts.programData, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(discriminator("create_vault")),
  });
}

function migrateAgentInstruction(accounts, existingConstraints) {
  const count = Buffer.alloc(2);
  count.writeUInt16LE(existingConstraints, 0);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: accounts.config, isSigner: false, isWritable: false },
      { pubkey: accounts.agent, isSigner: false, isWritable: true },
      { pubkey: accounts.signer, isSigner: true, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: accounts.programData, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator("migrate_agent"), count]),
  });
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const authority = loadKeypair(KEYPAIR_PATH);

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    PROGRAM_ID
  );
  const [programDataPDA] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  console.log(`cluster     ${RPC}`);
  console.log(`program     ${PROGRAM_ID.toBase58()}`);
  console.log(`signer      ${authority.publicKey.toBase58()}`);
  console.log(
    `balance     ${(await connection.getBalance(authority.publicKey)) / 1e9} SOL`
  );
  if (DRY_RUN) console.log(`mode        DRY RUN — nothing will be sent`);

  // ── what the deployment currently looks like ────────────────────────────
  const configInfo = await connection.getAccountInfo(configPDA);
  if (!configInfo) {
    throw new Error(
      "No config account: this program has not been initialized, so there is " +
        "nothing to migrate. Run initialize instead."
    );
  }
  const config = layout.decodeConfig(configInfo.data);
  const programDataInfo = await connection.getAccountInfo(programDataPDA);
  const upgradeAuthority =
    programDataInfo && programDataInfo.data[12] === 1
      ? new PublicKey(programDataInfo.data.slice(13, 45)).toBase58()
      : null;

  console.log(`config      admin ${config.admin}`);
  console.log(`            ${config.totalAgents} agents, ${config.totalBonds} bonds`);
  console.log(`upgrade     authority ${upgradeAuthority || "NONE (immutable)"}`);

  const signer = authority.publicKey.toBase58();
  const mayCreateVault =
    signer === config.admin || signer === upgradeAuthority;
  if (!mayCreateVault) {
    throw new Error(
      `Signer is neither the config admin (${config.admin}) nor the upgrade ` +
        `authority (${upgradeAuthority}). It cannot migrate this deployment.`
    );
  }

  // ── 1. the escrow vault ────────────────────────────────────────────────
  const vault = await connection.getAccountInfo(vaultPDA);
  if (vault) {
    const decoded = layout.decodeVault(vault.data);
    console.log(
      `\nvault       exists ${vaultPDA.toBase58()} ` +
        `(${decoded.availableLamports} lamports available)`
    );
  } else if (DRY_RUN) {
    console.log(`\nvault       MISSING ${vaultPDA.toBase58()} — would create it`);
  } else {
    const signature = await send(
      connection,
      createVaultInstruction({
        config: configPDA,
        vault: vaultPDA,
        payer: authority.publicKey,
        programData: programDataPDA,
      }),
      [authority]
    );
    console.log(`\nvault       created ${vaultPDA.toBase58()} in ${signature}`);
  }

  // ── 2. every agent still on the v0.1 layout ────────────────────────────
  const agentAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [layout.discriminatorFilter("Agent")],
  });
  console.log(
    `\nagents      ${agentAccounts.length} found on chain ` +
      `(v0.2 layout is ${layout.AGENT_LAYOUT_V2_SIZE} bytes, v0.1 is ` +
      `${layout.AGENT_LAYOUT_V1_SIZE})`
  );

  const stale = [];
  for (const { pubkey, account } of agentAccounts) {
    const decoded = layout.decodeAgent(account.data);
    if (decoded.layout === "v1") {
      stale.push({ pubkey, decoded });
    } else {
      console.log(`  ok        ${pubkey.toBase58()} (${decoded.name}) already v0.2`);
    }
  }

  if (stale.length === 0) {
    console.log(`\nNothing to migrate. The deployment is already up to v0.2.`);
    return;
  }

  for (const { pubkey, decoded } of stale) {
    // How many constraints this agent already has. This is asserted by the
    // caller because a program cannot enumerate its own PDAs; the seed index a
    // constraint occupies is recorded nowhere on chain for v0.1 agents. The
    // count is safe to get wrong in one direction only — the v0.1 accounts live
    // in a different seed space (a u64 index, not a u16), so a wrong number can
    // misreport the counter but can never collide with an existing account.
    const constraints = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        layout.discriminatorFilter("Constraint"),
        layout.pubkeyFilter(pubkey.toBase58(), layout.OFFSETS.Constraint.agent),
      ],
    });

    console.log(
      `\n  migrating ${pubkey.toBase58()} (${decoded.name}, ` +
        `${constraints.length} existing constraint${constraints.length === 1 ? "" : "s"})`
    );

    if (DRY_RUN) {
      console.log(
        `    would grow ${layout.AGENT_LAYOUT_V1_SIZE} -> ` +
          `${layout.AGENT_LAYOUT_V2_SIZE} bytes and set constraintCount=${constraints.length}`
      );
      continue;
    }

    await send(
      connection,
      migrateAgentInstruction(
        {
          config: configPDA,
          agent: pubkey,
          signer: authority.publicKey,
          programData: programDataPDA,
        },
        constraints.length
      ),
      [authority]
    );

    // ── audit: prove nothing but the counter moved ───────────────────────
    const after = await connection.getAccountInfo(pubkey);
    if (!after) throw new Error(`${pubkey.toBase58()} vanished during migration`);
    const now = layout.decodeAgent(after.data);

    if (after.data.length !== layout.AGENT_LAYOUT_V2_SIZE) {
      throw new Error(
        `${pubkey.toBase58()} is ${after.data.length} bytes after migration, ` +
          `expected ${layout.AGENT_LAYOUT_V2_SIZE}`
      );
    }
    if (now.layout !== "v2") {
      throw new Error(`${pubkey.toBase58()} still decodes as v0.1`);
    }
    for (const field of PRESERVED_AGENT_FIELDS) {
      if (String(now[field]) !== String(decoded[field])) {
        throw new Error(
          `Migration changed ${field} on ${pubkey.toBase58()}: ` +
            `${decoded[field]} -> ${now[field]}. This must never happen.`
        );
      }
    }
    if (now.constraintCount !== constraints.length) {
      throw new Error(
        `constraintCount is ${now.constraintCount}, expected ${constraints.length}`
      );
    }
    console.log(
      `    done      ${after.data.length} bytes, constraintCount=${now.constraintCount}, ` +
        `${PRESERVED_AGENT_FIELDS.length} preserved fields verified identical`
    );
  }

  console.log(
    DRY_RUN
      ? `\nWould migrate ${stale.length} agent(s). Nothing was sent.`
      : `\nMigrated ${stale.length} agent(s). Re-run to confirm nothing is left.`
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
