"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, randomBytes, sign } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const bs58 = require("bs58");
const { openStore } = require("./store");

const address = () => bs58.encode(randomBytes(32));
const config = { agentWallet: address(), mint: address(), origin: "https://payout.example", maxAmountRaw: "2000" };

test("signed approval, one durable claim, and idempotent route reporting", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "equxi-payout-"));
  const file = join(dir, "store.sqlite");
  const first = openStore(file, config);
  const second = openStore(file, config);
  t.after(() => { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const reviewer = bs58.encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const input = { reviewer, recipient: address(), amountRaw: "1000", maxDebitRaw: "1200" };
  assert.throws(() => first.create({ ...input, maxDebitRaw: "3000" }), /limit/);
  assert.throws(() => first.create({ ...input, recipient: config.agentWallet }), /recipient/);

  const payout = first.create(input);
  const { id } = payout.terms;
  const signature = sign(null, Buffer.from(payout.message), privateKey).toString("base64");
  const altered = sign(null, Buffer.from(payout.message.replace("1000", "1100")), privateKey).toString("base64");
  assert.throws(() => first.claim(id), /unapproved/);
  assert.throws(() => first.approve(id, altered), /failed verification/);
  assert.equal(first.approve(id, signature).state, "approved");
  assert.throws(() => second.approve(id, signature), /already/);
  assert.equal(second.claim(id).state, "claimed");
  assert.throws(() => first.claim(id), /already claimed/);

  const quote = { ...payout.terms, debitRaw: "1100" };
  assert.equal(first.checkQuote(id, quote).approved, true);
  assert.throws(() => first.checkQuote(id, { ...quote, recipient: address() }), /signed terms/);
  assert.throws(() => first.checkQuote(id, { ...quote, debitRaw: "1201" }), /cap/);
  assert.equal(second.read(id).state, "claimed");
  assert.throws(() => second.claim(id), /already claimed/);
  const transaction = bs58.encode(randomBytes(64));
  assert.equal(first.report(id, "route-1", transaction).state, "route_reported");
  assert.equal(second.report(id, "route-1", transaction).transactionSignature, transaction);
  assert.equal(second.markCreditVerified(id, transaction).state, "credit_verified");
  assert.throws(() => first.claim(id), /already claimed/);
  assert.throws(() => second.report(id, "route-2", bs58.encode(randomBytes(64))), /outstanding/);
});
