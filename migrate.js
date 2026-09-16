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

const fs = require("fs");
const os = require("os");
const path = require("path");

const anchor = require("@coral-xyz/anchor");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} = require("@solana/web3.js");

const layout = require("./lib/equxi-layout.js");
const IDL = require("./sdk/src/idl/equxi.json");

const RPC = process.env.EQUXI_RPC || "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.EQUXI_KEYPAIR || path.join(os.homedir(), ".config/solana/id.json");
const DRY_RUN = process.argv.includes("--dry-run");

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

async function main() {
  const programId = new PublicKey(IDL.address);
  const connection = new Connection(RPC, "confirmed");
  const authority = loadKeypair(KEYPAIR_PATH);

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(authority),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(IDL, provider);

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    programId
  );
  const [programDataPDA] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  console.log(`cluster     ${RPC}`);
  console.log(`program     ${programId.toBase58()}`);
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
  let vault = await connection.getAccountInfo(vaultPDA);
  if (vault) {
    const decoded = layout.decodeVault(vault.data);
    console.log(
      `\nvault       exists ${vaultPDA.toBase58()} ` +
        `(${decoded.availableLamports} lamports available)`
    );
  } else if (DRY_RUN) {
    console.log(`\nvault       MISSING ${vaultPDA.toBase58()} — would create it`);
  } else {
    const sig = await program.methods
      .createVault()
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        payer: authority.publicKey,
        program: programId,
        programData: programDataPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`\nvault       created ${vaultPDA.toBase58()} in ${sig}`);
  }

  // ── 2. every agent still on the v0.1 layout ────────────────────────────
  const agentAccounts = await connection.getProgramAccounts(programId, {
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
    const constraints = await connection.getProgramAccounts(programId, {
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
      console.log(`    would grow 116 -> 118 bytes and set constraintCount=${constraints.length}`);
      continue;
    }

    await program.methods
      .migrateAgent(constraints.length)
      .accounts({
        config: configPDA,
        agent: pubkey,
        signer: authority.publicKey,
        program: programId,
        programData: programDataPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

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
