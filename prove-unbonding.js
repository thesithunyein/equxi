/**
 * prove-unbonding.js — prove the refusal that makes the trust layer real.
 *
 * A bond that walks away the instant its lock expires can dodge a violation
 * observed one block earlier. That race is why the program keeps collateral
 * slashable through an unbonding window, and why withdraw_bond refuses with
 * BondInUnbondingPeriod after expiry instead of paying out.
 *
 * The on-chain suite pins this in tests/equxi.test.ts ("Refuses withdrawal
 * inside the unbonding window after the lock expired"); the arithmetic lives in
 * withdraw_bond.rs. Neither can be shown live, so this script reproduces the
 * exact refusal against devnet with the public SDK, using the minimum bond
 * (0.1 SOL) and a 1-second lock, and asserts the collateral stayed put:
 *
 *   1. register a fresh agent and lock 0.1 SOL for 1 second
 *   2. wait for the lock to expire — the bond is now inside its unbonding window
 *   3. attempt withdraw_bond; the program must refuse with
 *      BondInUnbondingPeriod (not BondNotExpired — the lock really did expire)
 *   4. re-read the bond: still active, amount still 100000000 lamports, and
 *      those lamports are still in the account
 *
 * Usage:
 *   node prove-unbonding.js <admin-keypair.json>
 *
 * The keypair must be the key that owns the config account — the same authority
 * that created the bond. On devnet that is
 * 3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR.
 */

const fs = require("fs");
const bs58 = require("bs58");
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { EquxiClient } = require("./sdk/dist");

const RPC = process.env.EQUXI_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");

// The key that owns the config account on devnet, i.e. the bond authority.
const DEVNET_AUTHORITY = "3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR";

const UNBONDING_PERIOD_S = 7 * 24 * 60 * 60; // must match the program constant
const BOND_LAMPORTS = 100_000_000; // the program's minimum bond: 0.1 SOL
const LOCK_SECONDS = 1;
const WINDOW_WAIT_MS = 2500; // same wait the on-chain refusal test uses

const keyPath = process.argv.slice(2).find((a) => !a.startsWith("--"));

const sol = (lamports) => (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4) + " SOL";

// Wall-clock stamps so the demo picks up segment timings for free.
const t0 = Date.now();
const stamp = () => ("+" + ((Date.now() - t0) / 1000).toFixed(1) + "s").padStart(7);
const log = (...a) => console.log(stamp(), ...a);

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
  if (decoded.length === 32) return Keypair.fromSeed(Uint8Array.from(decoded));
  throw new Error("unrecognised key material: " + decoded.length + " bytes");
}

let failures = 0;
const assert = (label, condition, detail) => {
  if (condition) {
    log("  PASS  " + label + (detail ? " — " + detail : ""));
  } else {
    failures++;
    log("  FAIL  " + label + (detail ? " — " + detail : ""));
  }
};

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

  if (!keyPath) {
    console.error("usage: node prove-unbonding.js <admin-keypair.json>");
    process.exitCode = 2;
    return;
  }

  const admin = loadKeypair(keyPath);
  log("authority        :", admin.publicKey.toBase58());

  const cfgInfo = await connection.getAccountInfo(configPDA);
  const onChainAdmin = new PublicKey(cfgInfo.data.slice(8, 40)).toBase58();
  log("config.admin     :", onChainAdmin);
  if (onChainAdmin !== admin.publicKey.toBase58()) {
    console.error("\nABORT: this key is not the config admin, so it cannot create or withdraw a bond.");
    process.exitCode = 1;
    return;
  }

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const client = new EquxiClient(provider);

  // ------------------------------------------------------------- 1. bond it
  log("\n[1/4] register an agent and lock the minimum bond (0.1 SOL, 1s lock)");
  const name = "Refusal" + Date.now().toString().slice(-6);
  const { agentPDA, tx: regTx } = await client.registerAgent(name, { trader: {} });
  log("      agent      :", agentPDA.toBase58(), "(" + name + ")");
  log("      register tx:", regTx);

  const { bondPDA, tx: bondTx } = await client.createBond(
    agentPDA,
    new anchor.BN(BOND_LAMPORTS),
    new anchor.BN(LOCK_SECONDS)
  );
  log("      bond       :", bondPDA.toBase58());
  log("      lock tx    :", bondTx);

  const bondRent = await connection.getMinimumBalanceForRentExemption(
    (await connection.getAccountInfo(bondPDA)).data.length
  );
  const bondLamports = await connection.getBalance(bondPDA);
  assert(
    "bond holds the minimum collateral plus its rent",
    bondLamports === BOND_LAMPORTS + bondRent,
    sol(bondLamports) + " (rent " + bondRent + ")"
  );

  // ------------------------------------------------- 2. let the lock expire
  log("\n[2/4] wait for the 1s lock to expire — the bond enters its unbonding window");
  await new Promise((r) => setTimeout(r, WINDOW_WAIT_MS));

  let bondState = await client.getBond(bondPDA);
  const waitUntil = Date.now() + 15_000;
  while (Number(bondState.expiresAt.toString()) > Math.floor(Date.now() / 1000) && Date.now() < waitUntil) {
    await new Promise((r) => setTimeout(r, 500));
    bondState = await client.getBond(bondPDA);
  }
  const expiresAt = Number(bondState.expiresAt.toString());
  const now = Math.floor(Date.now() / 1000);
  assert("lock has expired", now >= expiresAt, "expires_at " + new Date(expiresAt * 1000).toISOString());
  const withdrawableAt = expiresAt + UNBONDING_PERIOD_S;
  assert(
    "bond is inside the unbonding window, not yet withdrawable",
    now < withdrawableAt,
    "withdrawable at " + new Date(withdrawableAt * 1000).toISOString().slice(0, 10)
  );

  // ---------------------------------------------- 3. the program must refuse
  log("\n[3/4] withdraw_bond — the program must refuse inside the window");
  let refusal = null;
  try {
    const { tx } = await client.withdrawBond(agentPDA);
    log("      UNEXPECTED tx:", tx);
  } catch (e) {
    refusal = String((e && e.message) || e);
  }
  assert(
    "withdrawal was refused after expiry",
    refusal !== null,
    refusal ? refusal.split("\n")[0].slice(0, 160) : "withdrawal SUCCEEDED — the window did not hold"
  );
  assert(
    "refusal is BondInUnbondingPeriod, not BondNotExpired",
    /BondInUnbondingPeriod/.test(refusal || "") && !/BondNotExpired/.test(refusal || "")
  );

  // ---------------------------------------------- 4. nothing moved
  log("\n[4/4] the refusal is not a half-success — re-read the bond");
  const after = await client.getBond(bondPDA);
  const afterLamports = await connection.getBalance(bondPDA);
  assert("bond still active", after.isActive === true);
  assert("recorded amount unchanged", after.amount.toString() === String(BOND_LAMPORTS), after.amount.toString());
  assert(
    "collateral still in the account",
    afterLamports - bondRent === BOND_LAMPORTS,
    sol(afterLamports) + " (above rent " + sol(afterLamports - bondRent) + ")"
  );

  log("\n" + (failures ? failures + " ASSERTION(S) FAILED" : "All assertions passed — the collateral could not walk away."));
  // Set the code instead of calling process.exit(): exiting while libuv still
  // holds pending handles trips an assertion on Windows and reports 127.
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error("\nERROR:", e.message || e);
  process.exitCode = 1;
});
