#!/usr/bin/env node
/**
 * Equxi x Meteora DBC — "launch with safety escrow".
 *
 * The pitch is simple: a token launch on Meteora's dynamic bonding curve should not
 * only create liquidity, it should create **consequence**. This script launches a
 * token on DBC (devnet), drives it to graduation, claims the launch proceeds that are
 * configurable in the DBC config (`creatorTradingFee` + `migrationFee.creatorFee`), and
 * posts those lamports as an Equxi agent's slashable bond — so the same transaction
 * trail that creates the token also creates the collateral behind it.
 *
 * Everything here is real: real DBC config, real pool, real swaps, real fee claims, real
 * Equxi `register_agent` / `create_bond` on devnet. Each stage prints the signatures it
 * produced and is resumable, because on a public devnet RPC an RPC failure is normal.
 *
 * Usage:
 *   node launch-safety-bond.js <stage> [--keypair <path>]
 *
 *   stages: status | config | pool | buy | migrate | claim | bond | all
 *
 * Environment:
 *   METEORA_LAUNCH_KEYPAIR  keypair JSON (default ~/.config/solana/owed-devnet.json)
 *   EQUXI_RPC               RPC endpoint   (default https://api.devnet.solana.com)
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const BN = require("bn.js");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createCloseAccountInstruction,
} = require("@solana/spl-token");
const {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  CollectFeeMode,
  createSqrtPrices,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  SwapMode,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} = require("@meteora-ag/dynamic-bonding-curve-sdk");

const RPC = process.env.EQUXI_RPC || "https://api.devnet.solana.com";
const STATE_FILE = path.join(__dirname, "launch-state.json");

// Equxi, devnet. The program the bond lives in.
const EQUXI_PROGRAM_ID = new PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");

// The token being launched. One billion supply, 6 decimals, SOL quote.
const TOKEN_NAME = "Escrowed Agent";
const TOKEN_SYMBOL = "EAGT";
const TOKEN_URI = "https://equxi.sithunyein.com/meteora-launch.json";

// How much SOL the launch's buyer pushes through the curve. The curve is deliberately
// small so graduation is reachable on devnet at all: this config graduates at ~0.7 SOL
// of quote rather than the ~63 SOL a mainnet-scale curve implies. The final buy is a
// **partial fill**, so it stops exactly at the threshold instead of overshooting it.
const BUY_SOL = Number(process.env.METEORA_LAUNCH_BUY_SOL || 1.0);

// The agent whose bond the launch proceeds are posted to, and the terms of that
// bond. 0.1 SOL is Equxi's minimum; the lock is 30 days.
const AGENT_NAME = "EAGT";
const BOND_LOCK_SECONDS = 30 * 24 * 60 * 60;

const client = new DynamicBondingCurveClient(new Connection(RPC, "confirmed"), "confirmed");
const connection = client.connection;

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function loadKeypair() {
  const p = path.resolve(
    arg("keypair", process.env.METEORA_LAUNCH_KEYPAIR || path.join(os.homedir(), ".config/solana/owed-devnet.json"))
  );
  const bytes = JSON.parse(fs.readFileSync(p, "utf8"));
  if (bytes.length !== 64) throw new Error(`${p}: keypair JSON must contain 64 bytes, got ${bytes.length}`);
  return { keypair: Keypair.fromSecretKey(Uint8Array.from(bytes)), path: p };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(patch) {
  const next = { ...loadState(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function log(step, tx, extra) {
  console.log(`  ${step}: ${tx}${extra ? "  " + extra : ""}`);
  console.log(`    https://explorer.solana.com/tx/${tx}?cluster=devnet`);
}

async function send(tx, signers, payer) {
  tx.feePayer = tx.feePayer || payer;
  const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
  return sig;
}

/**
 * The curve. Price steps are tiny on purpose — this is a devnet demonstration of the
 * *mechanism*, and the mechanism is graduation, not a price target. Three segments with
 * weights [2, 1, 1] put roughly 1.4 SOL of quote into the curve before the final point,
 * which is what makes a real graduation affordable to drive.
 */
function buildCurve() {
  const sqrtPrices = createSqrtPrices(
    [0.000000001, 0.00000000105, 0.00000000125, 0.0000000015],
    TokenDecimal.SIX,
    TokenDecimal.NINE
  );

  return buildCurveWithCustomSqrtPrices({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.PartnerUpdateAuthority,
      totalTokenSupply: 1_000_000_000,
      leftover: 1_000,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      // Half of every trading fee is the creator's. This is one of the two config
      // knobs that make "launch proceeds" exist at all.
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      // The other knob: a slice of the graduated liquidity, half of it to the creator.
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 10, creatorFeePercentage: 50 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Enabled,
        poolFeeBps: 120,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices,
    liquidityWeights: [2, 1, 1],
  });
}

/** Equxi PDAs. Seeds mirror programs/equxi/src/instructions/*.rs. */
const equxi = {
  config: () => PublicKey.findProgramAddressSync([Buffer.from("config")], EQUXI_PROGRAM_ID)[0],
  agent: (owner, name) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), owner.toBuffer(), Buffer.from(name)],
      EQUXI_PROGRAM_ID
    )[0],
  bond: (agent) => PublicKey.findProgramAddressSync([Buffer.from("bond"), agent.toBuffer()], EQUXI_PROGRAM_ID)[0],
};

async function stageStatus() {
  const state = loadState();
  const { keypair } = loadKeypair();
  console.log(`wallet        ${keypair.publicKey.toBase58()}`);
  console.log(`balance       ${(await connection.getBalance(keypair.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  console.log(`config        ${state.config || "-"}`);
  console.log(`baseMint      ${state.baseMint || "-"}`);
  console.log(`pool          ${state.pool || "-"}`);
  console.log(`agent         ${state.agent || "-"}`);
  console.log(`bond          ${state.bond || "-"}`);

  if (state.pool) {
    const pool = new PublicKey(state.pool);
    const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
    const breakdown = await client.state.getPoolFeeBreakdown(pool);
    console.log(`curve         ${(progress * 100).toFixed(2)}% of the graduation threshold`);
    console.log(`creator fees  unclaimed base ${breakdown.creator.unclaimedBaseFee.toString()}, quote ${breakdown.creator.unclaimedQuoteFee.toString()}`);
    console.log(`partner fees  unclaimed base ${breakdown.partner.unclaimedBaseFee.toString()}, quote ${breakdown.partner.unclaimedQuoteFee.toString()}`);
  }
}

async function stageConfig() {
  const { keypair } = loadKeypair();
  const state = loadState();
  if (state.config) return console.log(`config already exists: ${state.config}`);

  const curve = buildCurve();
  console.log("curve parameters:");
  console.log(JSON.stringify(curve, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  const configKeypair = Keypair.generate();
  const tx = await client.partner.createConfig({
    config: configKeypair.publicKey,
    feeClaimer: keypair.publicKey,
    leftoverReceiver: keypair.publicKey,
    payer: keypair.publicKey,
    quoteMint: NATIVE_MINT,
    ...curve,
  });
  tx.feePayer = keypair.publicKey;
  const sig = await send(tx, [keypair, configKeypair], keypair.publicKey);
  saveState({ config: configKeypair.publicKey.toBase58() });
  log("createConfig", sig, `config=${configKeypair.publicKey.toBase58()}`);
}

async function stagePool() {
  const { keypair } = loadKeypair();
  const state = loadState();
  if (!state.config) throw new Error("run `config` first");
  if (state.pool) return console.log(`pool already exists: ${state.pool}`);

  const baseMint = Keypair.generate();
  const tx = await client.creator.createPool({
    baseMint: baseMint.publicKey,
    config: new PublicKey(state.config),
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_URI,
    payer: keypair.publicKey,
    poolCreator: keypair.publicKey,
  });
  tx.feePayer = keypair.publicKey;
  const sig = await send(tx, [keypair, baseMint], keypair.publicKey);

  const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, new PublicKey(state.config));
  saveState({ baseMint: baseMint.publicKey.toBase58(), pool: pool.toBase58() });
  log("createPool", sig, `mint=${baseMint.publicKey.toBase58()} pool=${pool.toBase58()}`);
  console.log(`  threshold: ${(await client.state.getPoolMigrationQuoteThreshold(pool)) / LAMPORTS_PER_SOL} SOL of quote`);
}

async function stageBuy() {
  const { keypair } = loadKeypair();
  const state = loadState();
  if (!state.pool) throw new Error("run `pool` first");

  const pool = new PublicKey(state.pool);
  const poolState = await client.state.getPool(pool);
  const configState = await client.state.getPoolConfig(poolState.poolState.config);
  const currentPoint = new BN(Math.floor(Date.now() / 1000));

  // Partial fill: consume only what the curve can take. A full exact-in buy that would
  // cross the graduation threshold is rejected by DBC, which is the property that makes
  // graduation a threshold rather than a suggestion.
  const amountIn = new BN(Math.round(BUY_SOL * LAMPORTS_PER_SOL));
  const quote = client.pool.swapQuote2({
    virtualPool: poolState,
    config: configState,
    swapBaseForQuote: false,
    swapMode: SwapMode.PartialFill,
    amountIn,
    slippageBps: 100,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  });

  const tx = await client.pool.swap2({
    owner: keypair.publicKey,
    payer: keypair.publicKey,
    pool,
    swapBaseForQuote: false,
    swapMode: SwapMode.PartialFill,
    amountIn,
    minimumAmountOut: quote.minimumAmountOut,
    referralTokenAccount: null,
  });
  tx.feePayer = keypair.publicKey;
  const sig = await send(tx, [keypair], keypair.publicKey);
  const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  log("buy (partial fill)", sig, `curve now ${(progress * 100).toFixed(2)}%`);
}

async function stageMigrate() {
  const { keypair } = loadKeypair();
  const state = loadState();
  if (!state.pool) throw new Error("run `pool` first");
  const pool = new PublicKey(state.pool);

  const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  console.log(`curve progress before migration: ${(progress * 100).toFixed(2)}%`);
  if (progress < 1) {
    console.log("the curve is not complete; DBC will refuse to migrate (that refusal is the point of a threshold).");
  }

  // Which DAMM v2 config the pool graduates into. DAMM v2 configs come in more than one
  // type, and only a *dynamic* one accepts a pool whose migrated fee mode is dynamic —
  // the wrong one fails with InvalidConfigType, which is how this list was discovered.
  // The SDK exports the official fee-config keys; try the ones this cluster actually has.
  const explicit = arg("damm-config", null);
  const candidates = explicit ? [new PublicKey(explicit)] : DAMM_V2_MIGRATION_FEE_ADDRESS;
  let lastError = null;

  for (const dammConfig of candidates) {
    const info = await connection.getAccountInfo(dammConfig);
    if (!info) {
      console.log(`  ${dammConfig.toBase58()}: not on this cluster, skipping`);
      continue;
    }
    try {
      // The builder mints the DAMM v2 position NFTs, so it hands back the two keypairs
      // that must sign its transaction — omitting them is what "Signature verification
      // failed" meant here, not a wrong account.
      const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } =
        await client.migration.migrateToDammV2({ payer: keypair.publicKey, pool, dammConfig });
      transaction.feePayer = keypair.publicKey;
      const sig = await send(
        transaction,
        [keypair, firstPositionNftKeypair, secondPositionNftKeypair].filter(Boolean),
        keypair.publicKey
      );
      saveState({ dammConfig: dammConfig.toBase58(), migrationTx: sig });
      log("migrateToDammV2", sig, `dammConfig=${dammConfig.toBase58()}`);
      return;
    } catch (e) {
      lastError = e;
      console.log(`  ${dammConfig.toBase58()} rejected: ${String(e.message).split("\n")[0]}`);
    }
  }

  throw new Error(`no DAMM v2 config accepted this migration: ${lastError && lastError.message}`);
}

async function stageClaim() {
  const { keypair } = loadKeypair();
  const state = loadState();
  if (!state.pool) throw new Error("run `pool` first");
  const pool = new PublicKey(state.pool);
  const wsolAccount = getAssociatedTokenAddressSync(NATIVE_MINT, keypair.publicKey);

  // Fees are paid in the quote token, so a claim lands in a wrapped-SOL account.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    keypair.publicKey,
    wsolAccount,
    keypair.publicKey,
    NATIVE_MINT
  );
  const MAX = new BN("18446744073709551615");

  // The quote fees are paid into a wrapped-SOL account, so it has to exist before any
  // claim runs: crediting a missing account fails inside the token program with
  // InvalidAccountData, which looks like a permission problem and is not one.
  const setupTx = new Transaction().add(ataIx);
  setupTx.feePayer = keypair.publicKey;
  log("open fee account", await send(setupTx, [keypair], keypair.publicKey), wsolAccount.toBase58());

  const before = await connection.getBalance(keypair.publicKey);
  const claimedLabels = [];

  const claim = async (label, build) => {
    try {
      const tx = await build();
      tx.feePayer = keypair.publicKey;
      log(label, await send(tx, [keypair], keypair.publicKey));
      claimedLabels.push(label);
    } catch (e) {
      console.log(`  ${label} not available: ${String(e.message).split("\n")[0]}`);
    }
  };

  // Trading fees are deliberately NOT claimed here: after graduation their vaults are
  // gone. Use the `claim-trading` stage before `migrate`. What survives graduation is the
  // migration fee — the "share of graduation proceeds" this whole flow is about.
  console.log("  (trading fees belong to `claim-trading`, which must run before `migrate`)");
  await claim("creatorWithdrawMigrationFee", () =>
    client.creator.creatorWithdrawMigrationFee({ pool, sender: keypair.publicKey })
  );
  await claim("partnerWithdrawMigrationFee", () =>
    client.partner.partnerWithdrawMigrationFee({ pool, sender: keypair.publicKey })
  );

  // The wrapped-SOL account holds exactly what the launch paid out: every swap this
  // script made consumed its whole input, so there is no leftover of ours in there.
  let claimed = 0n;
  try {
    for (let i = 0; i < 6; i++) {
      claimed = BigInt((await connection.getTokenAccountBalance(wsolAccount)).value.amount);
      if (claimed > 0n) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (e) {
    console.log(`  could not read the fee account: ${e.message}`);
  }
  saveState({ claimedFrom: claimedLabels });

  // Unwrap, so the proceeds sit as lamports and can be posted as collateral.
  const closeTx = new Transaction().add(
    ataIx,
    createCloseAccountInstruction(wsolAccount, keypair.publicKey, keypair.publicKey)
  );
  closeTx.feePayer = keypair.publicKey;
  log("unwrapWSOL", await send(closeTx, [keypair], keypair.publicKey));
  console.log(`  launch proceeds claimed: ${Number(claimed) / LAMPORTS_PER_SOL} SOL`);
  console.log(`  wallet now ${(await connection.getBalance(keypair.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  // Accumulate rather than overwrite: a second run of this stage claims nothing (the fees
  // are already home) and would otherwise zero out the launch's contribution.
  const measured = BigInt(await connection.getBalance(keypair.publicKey)) - BigInt(before);
  const previous = BigInt(loadState().claimedLamports || "0");
  saveState({
    claimedLamports: (previous + (measured > 0n ? measured : 0n)).toString(),
    walletLamportsAfterClaim: String(await connection.getBalance(keypair.publicKey)),
  });
}

/**
 * The trading fees of a DBC pool have to be claimed **before** the pool graduates.
 *
 * Learned the hard way on devnet: after `migrate_to_damm_v2` the curve's base/quote fee
 * vaults are gone, so `claim_creator_trading_fee` still reports the fee as unclaimed but
 * cannot execute — the claim simulates clean and fails, and the lamports stay behind in
 * the graduated pool. On the demo run that was 2,820,961 lamports of creator fees and
 * 2,820,962 of partner fees, which is why this stage exists separately.
 */
async function stageClaimTrading() {
  const { keypair } = loadKeypair();
  const state = loadState();
  const pool = new PublicKey(state.pool);
  const wsolAccount = getAssociatedTokenAddressSync(NATIVE_MINT, keypair.publicKey);

  const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  if (progress >= 1) {
    console.log(`  the curve is already complete (${(progress * 100).toFixed(2)}%) — trading fees must be claimed before graduation; skipping.`);
    return;
  }

  const MAX = new BN("18446744073709551615");
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      keypair.publicKey,
      wsolAccount,
      keypair.publicKey,
      NATIVE_MINT
    )
  );
  tx.feePayer = keypair.publicKey;
  log("open fee account", await send(tx, [keypair], keypair.publicKey), wsolAccount.toBase58());

  for (const [label, build] of [
    ["claimCreatorTradingFee", () => client.creator.claimCreatorTradingFeeToReceiver({ creator: keypair.publicKey, payer: keypair.publicKey, pool, maxBaseAmount: MAX, maxQuoteAmount: MAX, receiver: wsolAccount })],
    ["claimPartnerTradingFee", () => client.partner.claimPartnerTradingFeeToReceiver({ feeClaimer: keypair.publicKey, payer: keypair.publicKey, pool, maxBaseAmount: MAX, maxQuoteAmount: MAX, receiver: wsolAccount })],
  ]) {
    try {
      const claimTx = await build();
      claimTx.feePayer = keypair.publicKey;
      log(label, await send(claimTx, [keypair], keypair.publicKey));
    } catch (e) {
      console.log(`  ${label} not available: ${String(e.message).split("\n")[0]}`);
    }
  }
}

/**
 * Equxi instruction encoding, taken from the repository's own IDL rather than
 * hand-rolled: the discriminator bytes and the argument order are the contract.
 */
const equxiIdl = require(path.join(__dirname, "..", "sdk", "src", "idl", "equxi.json"));

function borshString(s) {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function equxiIx(name, argBuffers) {
  const ix = equxiIdl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`no ${name} in the Equxi IDL`);
  return Buffer.concat([Buffer.from(ix.discriminator), ...argBuffers]);
}

/**
 * Posts the launch's proceeds as an Equxi agent's bond: `register_agent` for the token's
 * agent, then `create_bond` funded by what the launch actually paid out.
 *
 * The bond is Equxi's minimum (0.1 SOL) when the launch raised less than that, and the
 * script says so out loud rather than quietly topping up: on this devnet curve the
 * launch's share lands just under the minimum, which is a fact about curve size, not
 * about the mechanism.
 */
async function stageBond() {
  const { keypair } = loadKeypair();
  const state = loadState();
  const config = equxi.config();
  const agent = equxi.agent(keypair.publicKey, AGENT_NAME);
  const bond = equxi.bond(agent);
  const systemProgram = new PublicKey("11111111111111111111111111111111");

  if (!state.bond) {
    const registerIx = {
      programId: EQUXI_PROGRAM_ID,
      keys: [
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: agent, isSigner: false, isWritable: true },
        { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: systemProgram, isSigner: false, isWritable: false },
      ],
      data: equxiIx("registerAgent", [borshString(AGENT_NAME), Buffer.from([0])]), // 0 = AgentType::Trader
    };
    const tx = new Transaction().add(registerIx);
    tx.feePayer = keypair.publicKey;
    log("register_agent", await send(tx, [keypair], keypair.publicKey), `agent=${agent.toBase58()}`);
  }

  const override = arg("claimed-sol", null);
  const claimed = override ? BigInt(Math.round(Number(override) * LAMPORTS_PER_SOL)) : BigInt(state.claimedLamports || "0");
  const MIN_BOND = 100_000_000n; // Equxi's documented minimum, 0.1 SOL
  const bondLamports = claimed >= MIN_BOND ? claimed : MIN_BOND;
  const topUp = bondLamports - claimed;
  console.log(
    `  funding the bond: ${Number(claimed) / LAMPORTS_PER_SOL} SOL of launch proceeds` +
      (topUp > 0n ? ` + ${Number(topUp) / LAMPORTS_PER_SOL} SOL top-up to reach Equxi's 0.1 SOL minimum` : "")
  );

  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(bondLamports, 0);
  const lock = Buffer.alloc(8);
  lock.writeBigInt64LE(BigInt(BOND_LOCK_SECONDS), 0);

  const createBondIx = {
    programId: EQUXI_PROGRAM_ID,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: bond, isSigner: false, isWritable: true },
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: systemProgram, isSigner: false, isWritable: false },
    ],
    data: equxiIx("createBond", [amount, lock]),
  };
  const tx = new Transaction().add(createBondIx);
  tx.feePayer = keypair.publicKey;
  const sig = await send(tx, [keypair], keypair.publicKey);
  saveState({ agent: agent.toBase58(), bond: bond.toBase58(), bondLamports: bondLamports.toString(), bondTx: sig });
  log("create_bond", sig, `bond=${bond.toBase58()} amount=${Number(bondLamports) / LAMPORTS_PER_SOL} SOL`);
  console.log(`  read it back: https://equxi.sithunyein.com/api/trust?agent=${agent.toBase58()}`);
}

module.exports = { equxi, loadKeypair, connection };

async function main() {
  const stage = process.argv[2] || "status";
  console.log(`equxi x meteora DBC — stage: ${stage}  (${RPC})`);
  const stages = {
    status: stageStatus,
    config: stageConfig,
    pool: stagePool,
    buy: stageBuy,
    "claim-trading": stageClaimTrading,
    migrate: stageMigrate,
    claim: stageClaim,
    bond: stageBond,
  };
  if (stage === "all") {
    for (const [name, fn] of Object.entries(stages)) {
      console.log(`\n== ${name} ==`);
      await fn();
    }
    return;
  }
  const fn = stages[stage];
  if (!fn) throw new Error(`unknown stage: ${stage} (one of ${Object.keys(stages).join(", ")}, all)`);
  await fn();
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
