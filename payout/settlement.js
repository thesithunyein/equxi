"use strict";

const { check } = require("./store");

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function verifyCredit(payout, transaction) {
  check(transaction, "Transaction is not finalized or was not found.", 409);
  check(transaction.meta && transaction.meta.err === null, "Transaction failed or has no execution metadata.", 409);
  check(Number.isSafeInteger(transaction.blockTime) &&
    transaction.blockTime >= Math.floor(payout.claimedAt / 1000),
  "Transaction predates the claim or has no block time.", 409);

  const { mint, recipient, amountRaw } = payout.terms;
  const before = transaction.meta.preTokenBalances;
  const after = transaction.meta.postTokenBalances;
  check(Array.isArray(before) && Array.isArray(after), "Transaction has no token balance evidence.", 409);

  function recipientTotal(balances) {
    return balances.reduce((total, balance) => {
      if (balance.mint !== mint) return total;
      check(balance.owner && balance.programId === SPL_TOKEN_PROGRAM,
        "Token balance data does not identify a supported SPL owner and program.", 409);
      if (balance.owner !== recipient) return total;
      const amount = balance.uiTokenAmount?.amount;
      check(typeof amount === "string" && /^[0-9]{1,20}$/.test(amount), "Invalid token balance evidence.", 409);
      return total + BigInt(amount);
    }, 0n);
  }

  check(recipientTotal(after) - recipientTotal(before) === BigInt(amountRaw),
    "The recipient's net token credit does not match the exact signed amount.", 409);
}

async function verifyMainnetCredit(payout, rpcUrl) {
  check(rpcUrl, "Set PAYOUT_RPC_URL to enable transaction verification.", 503);
  async function rpc(method, params) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || data.error || !Object.hasOwn(data, "result")) throw new Error();
      return data.result;
    } catch {
      check(false, "Solana RPC lookup failed. The reported route is unchanged.", 502);
    }
  }

  const [genesis, transaction] = await Promise.all([
    rpc("getGenesisHash", []),
    rpc("getTransaction", [payout.transactionSignature, {
      encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0,
    }]),
  ]);
  check(genesis === MAINNET_GENESIS, "The configured RPC is not Solana mainnet.", 502);
  verifyCredit(payout, transaction);
}

module.exports = { verifyCredit, verifyMainnetCredit };
