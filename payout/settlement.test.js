"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifyCredit } = require("./settlement");

test("finalized transaction evidence must match the exact recipient credit", () => {
  const payout = { claimedAt: 1000, terms: { recipient: "reviewed-wallet", mint: "mint", amountRaw: "1000" } };
  const balance = (owner, amount) => ({
    owner, mint: "mint", uiTokenAmount: { amount },
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  });
  const transaction = {
    blockTime: 2,
    meta: {
      err: null,
      preTokenBalances: [balance("reviewed-wallet", "50")],
      postTokenBalances: [balance("reviewed-wallet", "1050")],
    },
  };
  assert.doesNotThrow(() => verifyCredit(payout, transaction));
  assert.throws(() => verifyCredit(payout, null), /not finalized/);
  assert.throws(() => verifyCredit(payout, { ...transaction, blockTime: 0 }), /predates/);
  assert.throws(() => verifyCredit(payout, { ...transaction, meta: { ...transaction.meta, err: {} } }), /failed/);
  for (const postTokenBalances of [[balance("other-wallet", "1050")], [balance("reviewed-wallet", "1049")]]) {
    assert.throws(() => verifyCredit(payout, { ...transaction, meta: { ...transaction.meta, postTokenBalances } }), /exact signed amount/);
  }
});
