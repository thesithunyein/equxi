"use strict";

const { createPublicKey, randomUUID, verify } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const bs58 = require("bs58");

function check(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function address(value) {
  check(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && bs58.decode(value).length === 32, "Invalid Solana address.");
  return value;
}

function units(value) {
  check(typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value)
    && BigInt(value) <= 18446744073709551615n, "Enter a positive amount in base units.");
  return value;
}

function approvalMessage(terms) {
  return [
    "Equxi contractor payout approval v1",
    "Authorize one payout with the following terms.",
    JSON.stringify(terms),
  ].join("\n");
}

function openStore(filename, { agentWallet, origin, maxAmountRaw, mint }) {
  address(agentWallet);
  address(mint);
  units(maxAmountRaw);
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      terms TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'awaiting_approval',
      signature TEXT,
      claimed_at INTEGER,
      route_id TEXT,
      transaction_signature TEXT UNIQUE
    );
  `);

  function read(id) {
    const row = db.prepare("SELECT * FROM payouts WHERE id = ?").get(id);
    check(row, "Payout not found.", 404);
    const terms = JSON.parse(row.terms);
    return {
      terms,
      message: approvalMessage(terms),
      state: row.state,
      approvalSignature: row.signature,
      claimedAt: row.claimed_at,
      routeId: row.route_id,
      transactionSignature: row.transaction_signature,
    };
  }

  return {
    close: () => db.close(),
    read,
    create(input) {
      const recipient = address(input.recipient);
      check(recipient !== agentWallet, "The recipient must differ from the agent wallet.");
      const amountRaw = units(input.amountRaw);
      const maxDebitRaw = units(input.maxDebitRaw);
      check(BigInt(amountRaw) <= BigInt(maxDebitRaw) &&
        BigInt(maxDebitRaw) <= BigInt(maxAmountRaw), "Payout and debit cap exceed the configured limit.");
      const terms = {
        id: randomUUID(),
        origin,
        network: "solana-mainnet",
        agentWallet,
        reviewer: address(input.reviewer),
        recipient,
        mint,
        amountRaw,
        maxDebitRaw,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      db.prepare("INSERT INTO payouts (id, terms) VALUES (?, ?)").run(terms.id, JSON.stringify(terms));
      return read(terms.id);
    },
    approve(id, signature) {
      const payout = read(id);
      check(typeof signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(signature),
        "Invalid signature encoding.");
      const key = createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(bs58.decode(payout.terms.reviewer))]),
        format: "der",
        type: "spki",
      });
      check(verify(null, Buffer.from(payout.message), key, Buffer.from(signature, "base64")),
        "Approval signature failed verification.");
      const result = db.prepare(`
        UPDATE payouts SET state = 'approved', signature = ?
        WHERE id = ? AND state = 'awaiting_approval' AND json_extract(terms, '$.expiresAt') > ?
      `).run(signature, id, Date.now());
      check(result.changes === 1, "Payout is expired or has already been approved.", 409);
      return read(id);
    },
    claim(id) {
      const payout = read(id);
      check(BigInt(payout.terms.maxDebitRaw) <= BigInt(maxAmountRaw), "Payout exceeds the current debit cap.", 409);
      const now = Date.now();
      const result = db.prepare(`
        UPDATE payouts SET state = 'claimed', claimed_at = ?
        WHERE id = ? AND state = 'approved' AND json_extract(terms, '$.expiresAt') > ?
          AND json_extract(terms, '$.agentWallet') = ? AND json_extract(terms, '$.origin') = ? AND json_extract(terms, '$.mint') = ?
      `).run(now, id, now, agentWallet, origin, mint);
      check(result.changes === 1, "Payout is unapproved, expired, or already claimed. Do not initiate another route.", 409);
      return read(id);
    },
    checkQuote(id, quote) {
      const payout = read(id);
      const terms = payout.terms;
      check(payout.state === "claimed" && Date.now() < terms.expiresAt,
        "The execution claim is unavailable or expired.", 409);
      check(quote.network === terms.network && quote.agentWallet === terms.agentWallet
        && quote.recipient === terms.recipient && quote.mint === terms.mint
        && quote.amountRaw === terms.amountRaw, "Quote does not match signed terms.");
      const debit = BigInt(units(quote.debitRaw));
      check(debit >= BigInt(terms.amountRaw) && debit <= BigInt(terms.maxDebitRaw)
        && debit <= BigInt(maxAmountRaw), "Quote debit exceeds the approved cap or is below the payout.");
      return { approved: true, id };
    },
    report(id, routeId, transactionSignature) {
      const payout = read(id);
      check(typeof routeId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(routeId), "Invalid route ID.");
      check(typeof transactionSignature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transactionSignature)
        && bs58.decode(transactionSignature).length === 64, "Invalid transaction signature.");
      if (payout.routeId === routeId && payout.transactionSignature === transactionSignature) return payout;
      check(!db.prepare("SELECT id FROM payouts WHERE transaction_signature = ?").get(transactionSignature),
        "This transaction is already attached to a payout.", 409);
      const result = db.prepare(`
        UPDATE payouts SET state = 'route_reported', route_id = ?, transaction_signature = ?
        WHERE id = ? AND state = 'claimed'
      `).run(routeId, transactionSignature, id);
      check(result.changes === 1, "Only an outstanding claim can accept route evidence.", 409);
      return read(id);
    },
  };
}

module.exports = { openStore, check };
