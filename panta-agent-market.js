/**
 * panta-agent-market.js — create and trade the agent-risk market through Panta.
 *
 * This is the sidetrack's core artifact: an Equxi agent's on-chain collateral
 * history becomes a tradable prediction market whose resolution source is the
 * program itself, not a news feed or an oracle we control.
 *
 *   node panta-agent-market.js create --agent <agentPDA> --name "Witness260521" \
 *        --resolve-by 2026-11-15 [--key <keypair.json>] [--image <url>] [--dry-run]
 *
 *   node panta-agent-market.js buy --market <marketId> --side yes --amount 20.00 \
 *        [--key <keypair.json>] [--slippage 100] [--dry-run]
 *
 * Custody model, same as Panta mandates: Panta cooks the transaction, this
 * script's wallet signs it, the script broadcasts on our RPC, then reports the
 * signature back to Panta. No key ever leaves the machine.
 *
 * `--dry-run` stops after the quote: it validates the integration end to end
 * (auth, params, fee) without paying the creation fee or moving USDC.
 *
 * Environment:
 *   PANTA_API_KEY   pk_test_… or pk_live_… (required; mint one in the Panta
 *                   dashboard — register, then POST /account/keys/)
 *   RPC_URL         Solana RPC for broadcast (default: mainnet-beta, which is
 *                   where Panta's USDC market program lives)
 *
 * Powered by Panta — attribution required by Panta's Terms of Use wherever
 * Panta-powered functionality appears.
 */

const fs = require("fs");
const bs58 = require("bs58");
const {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require("@solana/web3.js");
const panta = require("./lib/panta.js");

const API_KEY = process.env.PANTA_API_KEY || "";
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const VALUE_FLAGS = ["--agent", "--name", "--resolve-by", "--key", "--image", "--market", "--side", "--amount", "--slippage", "--rpc", "--category"];
const positionals = [];
for (let i = 1; i < args.length; i++) {
  if (VALUE_FLAGS.includes(args[i])) { i++; continue; }
  if (args[i].startsWith("--")) continue;
  positionals.push(args[i]);
}

const sol = (usdc) => (Number(usdc) / 1_000_000).toFixed(2) + " USDC";

/** Same loader as the proof scripts: CLI JSON, or the base58 Phantom export. */
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

function keypairPath() {
  const path = opt("--key", positionals[0] || process.env.EQUXI_KEYPAIR);
  if (!path) {
    console.error("need a keypair: pass --key <keypair.json> (or set EQUXI_KEYPAIR)");
    process.exitCode = 2;
    return null;
  }
  return loadKeypair(path);
}

function requireKey() {
  if (!API_KEY) {
    console.error("\nPANTA_API_KEY is not set. The integration is built and tested without it,");
    console.error("but creating or trading a market needs a key:");
    console.error("  1. register:  curl -X POST https://live-api.panta.market/api/v1/auth/register/ \\");
    console.error("                -H 'Content-Type: application/json' \\");
    console.error("                -d '{\"email\":\"…\",\"password\":\"…\",\"name\":\"Equxi\"}'");
    console.error("  2. mint key:  curl -X POST https://live-api.panta.market/api/v1/account/keys/ \\");
    console.error("                -H 'Authorization: Bearer <access>' \\");
    console.error("                -d '{\"env\":\"test\",\"name\":\"equxi-agent-market\"}'");
    console.error("  3. export PANTA_API_KEY=pk_test_…");
    process.exitCode = 2;
    return false;
  }
  return true;
}

async function create() {
  if (!requireKey()) return;
  const wallet = keypairPath();
  if (!wallet) return;

  const agentAddress = opt("--agent");
  const agentName = opt("--name", "unnamed");
  const resolveByLabel = opt("--resolve-by");
  const imageUrl = opt("--image", "https://equxi.sithunyein.com/assets/logo.webp");

  if (!agentAddress || !resolveByLabel) {
    console.error("usage: node panta-agent-market.js create --agent <agentPDA> --name <name> --resolve-by <YYYY-MM-DD> [--key <keypair.json>] [--image <url>] [--dry-run]");
    process.exitCode = 2;
    return;
  }
  const resolveBy = Math.floor(Date.parse(resolveByLabel) / 1000);
  if (!isFinite(resolveBy)) {
    console.error("--resolve-by must be a parseable date, e.g. 2026-11-15");
    process.exitCode = 2;
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const plan = panta.agentMarketPlan({
    now,
    resolveBy,
    resolveByLabel,
    agentAddress,
    agentName,
    category: opt("--category", "crypto"),
  });
  const connection = new Connection(opt("--rpc", RPC_URL), "confirmed");
  const creator = wallet.publicKey.toBase58();

  console.log("creator        :", creator);
  console.log("agent          :", agentName, "(" + agentAddress + ")");
  console.log("question       :", plan.question);

  // ------------------------------------------------------------- 1. quote
  const quote = await panta.quoteMarketCreate(globalThis.fetch, API_KEY, {
    ...plan,
    wallet: creator,
    imageUrl,
  });
  console.log("\n[1/4] quote");
  console.log("      create session :", quote.createId);
  console.log("      expected event :", quote.expectedEventPda);
  console.log("      creation fee   :", sol(quote.paymentUsdc), "(liquidity " + sol(quote.liquidityInjectionUsdc) + ", platform " + sol(quote.platformRevenueUsdc) + ")");

  if (flag("--dry-run")) {
    console.log("\n--dry-run: quote validated end to end; nothing was built, signed or paid.");
    console.log("Powered by Panta.");
    return;
  }

  // ------------------------------------------------------------- 2. build
  const build = await panta.buildMarketCreate(globalThis.fetch, API_KEY, {
    createId: quote.createId,
    wallet: creator,
  });
  console.log("\n[2/4] build");
  console.log("      transaction     :", build.transaction.length, "base64 chars");
  console.log("      build fingerprint:", build.buildFingerprint);

  // ------------------------------------------------ 3. sign and broadcast
  const transaction = VersionedTransaction.deserialize(Buffer.from(build.transaction, "base64"));
  transaction.sign([wallet]);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3 });
  console.log("\n[3/4] broadcast");
  console.log("      signature       :", signature);
  console.log("      explorer        : https://explorer.solana.com/tx/" + signature);

  await connection.confirmTransaction(
    {
      signature,
      blockhash: build.recentBlockhash,
      lastValidBlockHeight: build.lastValidBlockHeight,
    },
    "confirmed"
  );

  // ---------------------------------------------------------- 4. register
  const registered = await panta.registerMarket(globalThis.fetch, API_KEY, {
    createId: quote.createId,
    signature,
  });
  console.log("\n[4/4] register");
  console.log("      market id       :", registered.marketId);
  console.log("      status          :", registered.status);
  console.log("\nThe market is live. Buy YES/NO with:");
  console.log("      node panta-agent-market.js buy --market " + registered.marketId + " --side yes --amount 20.00 --key <keypair.json>");
  console.log("\nPowered by Panta.");
}

async function buy() {
  if (!requireKey()) return;
  const wallet = keypairPath();
  if (!wallet) return;

  const marketId = opt("--market");
  const side = opt("--side", "yes");
  const amountUsdc = String(opt("--amount", "20.00"));
  if (!marketId) {
    console.error("usage: node panta-agent-market.js buy --market <marketId> --side yes|no --amount 20.00 [--key <keypair.json>] [--slippage 100] [--dry-run]");
    process.exitCode = 2;
    return;
  }

  const connection = new Connection(opt("--rpc", RPC_URL), "confirmed");
  const buyer = wallet.publicKey.toBase58();

  // ------------------------------------------------------------- 1. quote
  const quote = await panta.quotePrimaryBuy(globalThis.fetch, API_KEY, {
    wallet: buyer,
    marketId,
    side,
    amountUsdc,
    userId: "equxi",
  });
  // The quote echo is the one client-side binding we can check: refusing a
  // mismatch here prevents ever building (or later attributing) a transaction
  // against a different market than the operator named.
  if (quote.marketId !== marketId) {
    throw new Error(
      "quote answered for a different market (" + quote.marketId + ") — refusing to build"
    );
  }
  console.log("[1/3] quote");
  console.log("      buyer           :", buyer);
  console.log("      side            :", quote.side, "·", quote.amountUsdc, "USDC deposit");
  console.log("      expected shares :", quote.shares, "(average price " + quote.avgPrice + ")");
  console.log("      protocol fee    :", quote.feeUsdc, "USDC");

  if (flag("--dry-run")) {
    console.log("\n--dry-run: quote validated; nothing was built, signed or bought.");
    console.log("Powered by Panta.");
    return;
  }

  // ------------------------------------------------------------- 2. build
  const build = await panta.buildPrimaryBuy(globalThis.fetch, API_KEY, {
    quoteId: quote.quoteId,
    wallet: buyer,
    userId: "equxi",
    maxSlippageBps: Number(opt("--slippage", "100")),
  });

  const instructions = build.instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((account) => ({
          pubkey: new PublicKey(account.pubkey),
          isSigner: !!account.isSigner,
          isWritable: !!account.isWritable,
        })),
        data: Buffer.from(ix.data, "base64"),
      })
  );
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: build.recentBlockhash,
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet]);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3 });
  console.log("\n[2/3] broadcast");
  console.log("      signature       :", signature);

  await connection.confirmTransaction(
    {
      signature,
      blockhash: build.recentBlockhash,
      lastValidBlockHeight: build.lastValidBlockHeight,
    },
    "confirmed"
  );

  // ------------------------------------------------- 3. submit + attribute
  const submitted = await panta.submitPrimaryBuy(globalThis.fetch, API_KEY, {
    orderId: build.orderId,
    signature,
    wallet: buyer,
  });
  const reported = await panta.reportTrade(globalThis.fetch, API_KEY, {
    signature,
    wallet: buyer,
    marketId,
    quoteId: quote.quoteId,
    clientOrderId: build.orderId,
    userId: "equxi",
  });
  console.log("\n[3/3] submit + attribute");
  console.log("      order status    :", submitted.status);
  console.log("      attribution     :", reported.status, "(" + reported.kind + ")");
  console.log("\nPowered by Panta.");
}

function usage() {
  console.log("usage:");
  console.log("  node panta-agent-market.js create --agent <agentPDA> --name <name> --resolve-by <YYYY-MM-DD> [--key <keypair.json>] [--image <url>] [--dry-run]");
  console.log("  node panta-agent-market.js buy    --market <marketId> --side yes|no --amount 20.00 [--key <keypair.json>] [--slippage 100] [--dry-run]");
  console.log("\nPANTA_API_KEY must be set (see the header of this file). --dry-run validates via the quote only.");
  // Bare invocation prints help (0); an unknown command is a misuse (2).
  process.exitCode = command ? 2 : 0;
}

if (command === "create") {
  create().catch((error) => {
    console.error("\nERROR:", error.code ? error.code + " — " : "", error.message || error);
    process.exitCode = 1;
  });
} else if (command === "buy") {
  buy().catch((error) => {
    console.error("\nERROR:", error.code ? error.code + " — " : "", error.message || error);
    process.exitCode = 1;
  });
} else {
  usage();
}
