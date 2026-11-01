/**
 * lib/aas2/anchor-tx.js — write the three memos that make a receipt L3.
 *
 * The read side (`anchors.js`) deliberately speaks raw JSON-RPC so verification
 * needs nothing but `fetch`. The write side needs a keypair, a recent blockhash,
 * and a signature, which is enough machinery that reimplementing it would be a
 * second place to get transaction encoding wrong. So this module uses
 * `@solana/web3.js`, loaded lazily: an API or a verifier that never submits an
 * anchor never pays for the dependency.
 *
 * What goes on-chain is still only the memo. The transaction carries no program
 * state and no record values (P10), and the payer key is not part of the
 * commitment.
 */
"use strict";

var fs = require("node:fs");
var path = require("node:path");

var anchorsLib = require("./anchors.js");
var canonical = require("./canonical.js");

var Aas2Error = canonical.Aas2Error;

function solana() {
  try {
    return require("@solana/web3.js");
  } catch (error) {
    throw new Aas2Error(
      "anchor_missing_dep",
      "submitting an anchor needs @solana/web3.js; run `npm install` in the repository"
    );
  }
}

function connect(rpcUrl) {
  var web3 = solana();
  return new web3.Connection(rpcUrl, "confirmed");
}

/** Solana CLI keypair format: a JSON array of the 64-byte secret key. */
function loadKeypair(file) {
  var web3 = solana();
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Aas2Error("anchor_bad_keypair", "cannot read keypair " + file + ": " + error.message);
  }
  if (!Array.isArray(raw) || raw.length !== 64) {
    throw new Aas2Error("anchor_bad_keypair", "keypair must be a JSON array of 64 bytes");
  }
  return web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

function saveKeypair(file, keypair) {
  var target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  return target;
}

function generateKeypair() {
  return solana().Keypair.generate();
}

function memoInstruction(memo) {
  var web3 = solana();
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(anchorsLib.MEMO_PROGRAM_ID),
    keys: [],
    data: Buffer.from(memo, "utf8"),
  });
}

/**
 * Waits for an RPC node to report a block time. A confirmed transaction can be
 * visible before the node backfills `blockTime`, and L3 ordering is meaningless
 * without it, so a missing time is retried instead of treated as zero.
 */
async function waitForAnchor(connection, signature, attempts) {
  var limit = attempts || 20;

  for (var i = 0; i < limit; i += 1) {
    var info = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (info && info.blockTime !== null && info.blockTime !== undefined) {
      return { tx: signature, slot: info.slot, block_time: info.blockTime };
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, 1000);
    });
  }

  throw new Aas2Error("anchor_unconfirmed", "transaction has no block time yet: " + signature);
}

async function submitMemo(connection, payer, memo) {
  var web3 = solana();
  var transaction = new web3.Transaction().add(memoInstruction(memo));
  transaction.feePayer = payer.publicKey;

  var signature = await web3.sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: "confirmed",
  });

  var anchor = await waitForAnchor(connection, signature);
  return Object.assign(anchor, { memo: memo });
}

async function submitAnchor(connection, payer, kind, hash) {
  return submitMemo(connection, payer, anchorsLib.memoFor(kind, hash));
}

async function requestAirdrop(connection, publicKey, sol) {
  var web3 = solana();
  var lamports = Math.round(sol * web3.LAMPORTS_PER_SOL);
  var signature = await connection.requestAirdrop(publicKey, lamports);

  var latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed"
  );

  return signature;
}

module.exports = {
  connect: connect,
  loadKeypair: loadKeypair,
  saveKeypair: saveKeypair,
  generateKeypair: generateKeypair,
  memoInstruction: memoInstruction,
  waitForAnchor: waitForAnchor,
  submitMemo: submitMemo,
  submitAnchor: submitAnchor,
  requestAirdrop: requestAirdrop,
};
