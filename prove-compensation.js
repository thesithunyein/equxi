/**
 * prove-compensation.js — prove the AAS-1 money path on devnet, with assertions.
 *
 * Everything else in this repo is verified: the read layer, the layouts, the
 * migration, the IDL. The one claim that had no on-chain evidence was the one the
 * protocol exists for — that slashed collateral actually reaches the vault and
 * then actually reaches a victim. As of the last audit, devnet held two slash
 * records for 0.1 SOL each while the vault held exactly its rent-exempt minimum:
 * the records said money moved, the lamports said it never did.
 *
 * This script produces the missing evidence, and refuses to print success unless
 * the balances agree:
 *
 *   1. register a fresh agent and lock a real bond
 *   2. execute_slash  -> assert the vault grows by exactly the slash amount
 *   3. compensate_victim -> assert the victim's balance grows by exactly the
 *      payout and the vault drops back to rent-exempt only
 *   4. re-read the deployed trust API and assert it reports the slash as
 *      compensated
 *
 * Usage:
 *   node prove-compensation.js <admin-keypair.json>
 *
 * The keypair must be the key that owns the config account — the same key the
 * program derives its slash/compensate authority from. On devnet that is
 * 3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR (see `--who` to print it).
 *
 * Options:
 *   --who              print the required authority and exit (no key needed)
 *   --probe-expired    additionally attempt a slash against the expired Augur
 *                      bond, to record on-chain whether expiry blocks seizure
 *   --bond <SOL>       bond size           (default 0.5)
 *   --slash <SOL>      slash size          (default 0.2)
 */

const fs = require("fs");
const bs58 = require("bs58");
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { EquxiClient } = require("./sdk/dist");

const RPC = process.env.EQUXI_RPC || "https://api.devnet.solana.com";
const API = process.env.EQUXI_API || "https://equxi.sithunyein.com/api/trust";
const PROGRAM_ID = new PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");

// The key that owns the config account on devnet, i.e. the slash/compensate authority.
const DEVNET_AUTHORITY = "3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR";
const AUGUR_OWNER = DEVNET_AUTHORITY;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

// Positional arguments, i.e. the keypair path, ignoring flags and their values.
const VALUE_FLAGS = ["--bond", "--slash"];
const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (VALUE_FLAGS.includes(args[i])) { i++; continue; }
  if (args[i].startsWith("--")) continue;
  positionals.push(args[i]);
}
const keyPath = positionals[0];

const sol = (lamports) => (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4) + " SOL";

/**
 * Accepts either a Solana CLI keypair file (a JSON array of 64 bytes) or the
 * base58 string Phantom hands you when you export a private key.
 */
function loadKeypair(path) {
  const raw = fs.readFileSync(path, "utf8").trim();
  if (raw.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(raw));
    if (bytes.length !== 64) throw new Error("keypair JSON must contain 64 bytes, got " + bytes.length);
    return Keypair.fromSecretKey(bytes);
  }
  const decoded = bs58.decode(raw);
  if (decoded.length === 64) return Keypair.fromSecretKey(Uint8Array.from(decoded));
  // Some wallets and tools export the 32-byte seed instead of the 64-byte secret key.
  if (decoded.length === 32) return Keypair.fromSeed(Uint8Array.from(decoded));
  throw new Error("unrecognised key material: " + decoded.length + " bytes");
}

let failures = 0;
const assert = (label, condition, detail) => {
  if (condition) {
    console.log("  PASS  " + label + (detail ? " — " + detail : ""));
  } else {
    failures++;
    console.log("  FAIL  " + label + (detail ? " — " + detail : ""));
  }
};

async function main() {
  const connection = new Connection(RPC, "confirmed");

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

  if (flag("--who")) {
    const cfg = await connection.getAccountInfo(configPDA);
    const admin = cfg ? new PublicKey(cfg.data.slice(8, 40)).toBase58() : "(config missing)";
    console.log("config PDA          :", configPDA.toBase58());
    console.log("required authority  :", admin);
    console.log("expected on devnet  :", DEVNET_AUTHORITY);
    return;
  }

  if (!keyPath) {
    console.error("usage: node prove-compensation.js <admin-keypair.json>   (add --who to just print the required key)");
    process.exitCode = 2;
    return;
  }

  const admin = loadKeypair(keyPath);
  console.log("authority        :", admin.publicKey.toBase58());

  const cfgInfo = await connection.getAccountInfo(configPDA);
  const onChainAdmin = new PublicKey(cfgInfo.data.slice(8, 40)).toBase58();
  console.log("config.admin     :", onChainAdmin);
  if (onChainAdmin !== admin.publicKey.toBase58()) {
    console.error("\nABORT: this key is not the config admin, so it cannot slash or compensate.");
    console.error("The program will reject execute_slash / compensate_victim with ConstraintAdmin.");
    process.exitCode = 1;
    return;
  }

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const client = new EquxiClient(provider);

  const vaultInfo = async () => {
    const info = await connection.getAccountInfo(vaultPDA);
    const rent = await connection.getMinimumBalanceForRentExemption(info.data.length);
    return { lamports: info.lamports, rent, aboveRent: info.lamports - rent };
  };

  const bondSol = Number(opt("--bond", "0.5"));
  const slashSol = Number(opt("--slash", "0.2"));

  // ---------------------------------------------------------------- 1. bond it
  console.log("\n[1/4] register an agent and lock a bond");
  const name = "Witness" + Date.now().toString().slice(-6);
  const { agentPDA, tx: regTx } = await client.registerAgent(name, { trader: {} });
  console.log("      agent      :", agentPDA.toBase58(), "(" + name + ")");
  console.log("      register tx:", regTx);

  const { bondPDA, tx: bondTx } = await client.createBond(
    agentPDA,
    new anchor.BN(bondSol * LAMPORTS_PER_SOL),
    new anchor.BN(86_400)
  );
  console.log("      bond       :", bondPDA.toBase58());
  console.log("      lock tx    :", bondTx);

  const bondAccount = await connection.getAccountInfo(bondPDA);
  const bondRent = await connection.getMinimumBalanceForRentExemption(bondAccount.data.length);
  const bondLamports = bondAccount.lamports;
  assert(
    "bond holds the deposited collateral plus its rent",
    bondLamports === bondSol * LAMPORTS_PER_SOL + bondRent,
    sol(bondLamports) + " (rent " + bondRent + ")"
  );

  // --------------------------------------------------------------- 2. slash it
  console.log("\n[2/4] execute_slash — collateral must land in the escrow vault");
  const config = await client.getConfig();
  const nonce = config.totalSlashed;
  const vaultBefore = await vaultInfo();
  const vaultStateBefore = await client.getVault();
  console.log("      vault before:", sol(vaultBefore.lamports), "(above rent: " + sol(vaultBefore.aboveRent) + ")");

  const { slashPDA, tx: slashTx } = await client.executeSlash(
    agentPDA,
    "prove-compensation: demonstrated violation",
    new anchor.BN(slashSol * LAMPORTS_PER_SOL)
  );
  console.log("      slash record:", slashPDA.toBase58(), "nonce " + nonce.toString());
  console.log("      slash tx    :", slashTx);

  const vaultAfterSlash = await vaultInfo();
  console.log("      vault after :", sol(vaultAfterSlash.lamports), "(above rent: " + sol(vaultAfterSlash.aboveRent) + ")");
  const seized = vaultAfterSlash.aboveRent - vaultBefore.aboveRent;
  assert("vault grew by exactly the slash amount", seized === slashSol * LAMPORTS_PER_SOL, "delta " + sol(seized));

  // totalSlashed and available are cumulative counters, so this run's proof is
  // the delta: a demo must be re-runnable without the vault needing a reset.
  const vaultState = await client.getVault();
  const seizedTotal = Number(vaultState.totalSlashed) - Number(vaultStateBefore.totalSlashed);
  const seizedAvailable = Number(vaultState.available) - Number(vaultStateBefore.available);
  assert("vault.totalSlashed grew by exactly the seizure", seizedTotal === slashSol * LAMPORTS_PER_SOL, "+" + sol(seizedTotal) + " (total now " + sol(vaultState.totalSlashed) + ")");
  assert("vault.available grew by exactly the seizure", seizedAvailable === slashSol * LAMPORTS_PER_SOL, "+" + sol(seizedAvailable));

  // The seizure must come *out of the bond*, and the bond's recorded amount must
  // still describe the collateral it actually holds (AAS-1 I5).
  const bondAfterSlash = await connection.getBalance(bondPDA);
  assert(
    "slash moved exactly the slashed amount out of the bond",
    bondLamports - bondAfterSlash === slashSol * LAMPORTS_PER_SOL,
    "bond " + sol(bondLamports) + " -> " + sol(bondAfterSlash)
  );
  const bondStateAfterSlash = await client.getBond(bondPDA);
  assert(
    "bond's recorded amount equals the collateral it still holds",
    Number(bondStateAfterSlash.amount.toString()) === (bondSol - slashSol) * LAMPORTS_PER_SOL &&
      bondAfterSlash - bondRent === Number(bondStateAfterSlash.amount.toString()),
    "recorded " + bondStateAfterSlash.amount.toString() + ", holds " + (bondAfterSlash - bondRent)
  );

  // ------------------------------------------------------------ 3. pay victim
  console.log("\n[3/4] compensate_victim — the vault must pay a third party");
  const victim = Keypair.generate();
  const victimBefore = await connection.getBalance(victim.publicKey);
  console.log("      victim      :", victim.publicKey.toBase58());

  const { tx: payTx } = await client.compensateVictim(
    agentPDA,
    nonce,
    victim.publicKey,
    new anchor.BN(slashSol * LAMPORTS_PER_SOL)
  );
  console.log("      payout tx   :", payTx);

  const victimAfter = await connection.getBalance(victim.publicKey);
  const paid = victimAfter - victimBefore;
  assert("victim received exactly the payout", paid === slashSol * LAMPORTS_PER_SOL, "delta " + sol(paid));

  const vaultAfterPay = await vaultInfo();
  assert("vault returned to rent-exempt only", vaultAfterPay.aboveRent === 0, "above rent " + sol(vaultAfterPay.aboveRent));

  const after = await client.getVault();
  assert("totalSlashed - totalCompensated == vault lamports above rent",
    Number(after.totalSlashed) - Number(after.totalCompensated) === vaultAfterPay.aboveRent,
    after.totalSlashed.toString() + " - " + after.totalCompensated.toString() + " == " + vaultAfterPay.aboveRent);

  // Payouts come from the vault only: the bond must be exactly where the slash
  // left it, both in lamports and in its recorded amount (AAS-1 I5).
  const bondAfterPay = await connection.getBalance(bondPDA);
  assert("compensation did not touch the bond's lamports", bondAfterPay === bondAfterSlash, sol(bondAfterPay));
  const bondStateAfterPay = await client.getBond(bondPDA);
  assert(
    "compensation did not mutate the bond's recorded amount",
    bondStateAfterPay.amount.toString() === bondStateAfterSlash.amount.toString(),
    bondStateAfterSlash.amount.toString() + " -> " + bondStateAfterPay.amount.toString()
  );

  // ------------------------------------------------------- 4. public evidence
  console.log("\n[4/4] the public read path must report it");
  const profile = await client.getTrustProfile(agentPDA);
  console.log("      grade/score :", profile.grade, "/", profile.score);
  assert("profile records the slash as compensated", profile.slashes.some((s) => s.compensated === true));

  try {
    const res = await fetch(API + "?agent=" + agentPDA.toBase58());
    const json = await res.json();
    const apiAgent = (json.agents || [])[0];
    const apiSlash = apiAgent && apiAgent.profile.slashes.find((s) => s.compensated);
    assert("deployed /api/trust reports the compensation", !!apiSlash,
      apiSlash ? "victim " + apiSlash.victim + ", " + sol(apiSlash.amountLamports) : "no compensated slash in API response");
  } catch (e) {
    assert("deployed /api/trust reachable", false, e.message);
  }

  // -------------------------------------------------- optional: expired bond
  if (flag("--probe-expired")) {
    console.log("\n[probe] is an expired bond still slashable? (design question)");
    const [augurAgent] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), new PublicKey(AUGUR_OWNER).toBuffer(), Buffer.from("Augur")],
      PROGRAM_ID
    );
    const [augurBond] = PublicKey.findProgramAddressSync([Buffer.from("bond"), augurAgent.toBuffer()], PROGRAM_ID);
    const bondInfo = await connection.getAccountInfo(augurBond);
    if (!bondInfo) {
      console.log("      Augur's bond account is gone (already withdrawn) — nothing to probe");
    } else {
      const expiresAt = Number(bondInfo.data.readBigInt64LE(8 + 32 + 32 + 8 + 8 + 8));
      const isActive = bondInfo.data.readUInt8(8 + 32 + 32 + 8 + 8 + 8 + 8);
      const now = Math.floor(Date.now() / 1000);
      console.log("      expires_at  :", expiresAt, "(expired: " + (now >= expiresAt) + "), is_active:", isActive);
      try {
        const { tx } = await client.executeSlash(augurAgent, "probe: expired bond seizure", new anchor.BN(0.01 * LAMPORTS_PER_SOL));
        console.log("      RESULT      : expired bond WAS slashed —", tx);
        console.log("      => expiry does not protect the operator from seizure,");
        console.log("         but withdraw_bond would have made this impossible: the race is the risk.");
      } catch (e) {
        console.log("      RESULT      : slash rejected —", (e.message || String(e)).slice(0, 200));
      }
    }
  }

  console.log("\n" + (failures ? failures + " ASSERTION(S) FAILED" : "All assertions passed — the money moved."));
  // Set the code instead of calling process.exit(): exiting while libuv still
  // holds pending handles trips an assertion on Windows and reports 127.
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error("\nERROR:", e.message || e);
  process.exitCode = 1;
});
