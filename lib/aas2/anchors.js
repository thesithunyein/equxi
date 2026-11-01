/**
 * lib/aas2/anchors.js — read the three memos that make a receipt L3.
 *
 * Anchors are SPL Memo transactions, not program instructions. That is a
 * deliberate boundary: the AAS-1 program keeps its account layout, and an
 * anchor is still a permanent, ordered, timestamped statement that anyone can
 * read without our code.
 *
 * The memo is the whole payload and it is short on purpose:
 *
 *     equxi:aas2:v0.1:agreement:sha256:<64 hex>
 *     equxi:aas2:v0.1:output:sha256:<64 hex>
 *     equxi:aas2:v0.1:receipt:sha256:<64 hex>
 *
 * Nothing else goes on-chain. No record values, no party names, no counts.
 *
 * Slot order is the ordering proof (`agreement.slot < output.slot <
 * receipt.slot`). Equal slots are not order: two transactions in one slot can
 * land in either order, so an implementation that treats `<=` as ordered would
 * claim something it cannot prove.
 */
"use strict";

var canonical = require("./canonical.js");

var Aas2Error = canonical.Aas2Error;

var MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
var MEMO_PREFIX = "equxi:aas2:v0.1:";
var KINDS = ["agreement", "output", "receipt"];

function memoFor(kind, hash) {
  if (KINDS.indexOf(kind) === -1) {
    throw new Aas2Error("bad_anchor_kind", "unknown anchor kind: " + kind);
  }
  if (!canonical.isHash(hash)) {
    throw new Aas2Error("bad_anchor_hash", "anchor hash must be sha256:<64 hex>");
  }
  return MEMO_PREFIX + kind + ":" + hash;
}

function parseMemo(memo) {
  if (typeof memo !== "string" || memo.indexOf(MEMO_PREFIX) !== 0) return null;
  var rest = memo.slice(MEMO_PREFIX.length);
  var split = rest.indexOf(":");
  if (split === -1) return null;

  var kind = rest.slice(0, split);
  var hash = rest.slice(split + 1);
  if (KINDS.indexOf(kind) === -1 || !canonical.isHash(hash)) return null;

  return { kind: kind, hash: hash };
}

function isAnchor(anchor, kind) {
  if (!anchor || typeof anchor !== "object") return kind + " anchor is missing";
  if (typeof anchor.tx !== "string" || anchor.tx === "") return kind + " anchor has no tx";
  if (!Number.isInteger(anchor.slot) || anchor.slot < 0) return kind + " anchor has no integer slot";
  return null;
}

/**
 * Structural validation of an anchor set that the verifier was handed. It
 * checks presence, memo content, and ordering. It does not prove the
 * transaction exists or that the memo is in it; `readAnchor` does that over
 * RPC. A caller that skips the RPC check must not claim L3.
 */
function validateAnchorSet(anchors, expected) {
  var errors = [];

  KINDS.forEach(function (kind) {
    var problem = isAnchor(anchors && anchors[kind], kind);
    if (problem) {
      errors.push(problem);
      return;
    }

    var memo = anchors[kind].memo;
    if (memo !== undefined) {
      var parsed = parseMemo(memo);
      if (!parsed) errors.push(kind + " anchor memo is not an AAS-2 memo");
      else if (parsed.kind !== kind) errors.push(kind + " anchor memo names " + parsed.kind);
      else if (expected && expected[kind] && parsed.hash !== expected[kind]) {
        errors.push(kind + " anchor memo does not match the receipt hash");
      }
    } else if (expected && expected[kind]) {
      errors.push(kind + " anchor has no memo to check");
    }
  });

  if (errors.length) return { ok: false, errors: errors };

  if (!(anchors.agreement.slot < anchors.output.slot)) {
    errors.push("agreement slot is not before output slot");
  }
  if (!(anchors.output.slot < anchors.receipt.slot)) {
    errors.push("output slot is not before receipt slot");
  }

  KINDS.forEach(function (kind) {
    if (anchors[kind].block_time !== undefined && !Number.isInteger(anchors[kind].block_time)) {
      errors.push(kind + " anchor block_time is not an integer");
    }
  });

  return { ok: errors.length === 0, errors: errors };
}

function rpcCall(rpcUrl, body, fetchImpl) {
  var init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };

  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(10000);
  }

  return fetchImpl(rpcUrl, init);
}

/**
 * Reads one transaction and returns the first AAS-2 memo in it, plus the slot
 * and block time that ordering and the L3 deadline depend on.
 */
async function readAnchor(rpcUrl, signature, fetchImpl) {
  var doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Aas2Error("anchor_no_fetch", "no fetch implementation available");
  }

  var response;
  try {
    response = await rpcCall(
      rpcUrl,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
        ],
      },
      doFetch
    );
  } catch (error) {
    throw new Aas2Error("anchor_rpc_failed", "anchor lookup failed: " + error.message);
  }

  if (!response || !response.ok) {
    throw new Aas2Error("anchor_rpc_failed", "anchor lookup returned HTTP " + (response && response.status));
  }

  var body = await response.json();
  if (body.error) {
    throw new Aas2Error("anchor_rpc_failed", "anchor RPC error: " + body.error.message);
  }
  if (!body.result) {
    throw new Aas2Error("anchor_not_found", "transaction not found: " + signature);
  }

  var result = body.result;
  var message = result.transaction && result.transaction.message;
  var accountKeys = (message && message.accountKeys) || [];
  var instructions = (message && message.instructions) || [];

  for (var i = 0; i < instructions.length; i += 1) {
    var instruction = instructions[i];
    var programId = accountKeys[instruction.programIdIndex];
    if (programId !== MEMO_PROGRAM_ID) continue;

    var memo = Buffer.from(instruction.data || "", "base64").toString("utf8");
    var parsed = parseMemo(memo);
    if (!parsed) continue;

    return {
      anchor: {
        tx: signature,
        slot: result.slot,
        block_time: result.blockTime === null ? undefined : result.blockTime,
        memo: memo,
      },
      kind: parsed.kind,
      hash: parsed.hash,
    };
  }

  throw new Aas2Error("anchor_no_memo", "transaction has no AAS-2 memo: " + signature);
}

/**
 * Reads all three anchors and checks them against the receipt's hashes. This is
 * the only path that may promote a receipt to L3.
 */
async function readAnchorSet(rpcUrl, signatures, expected, fetchImpl) {
  var anchors = {};

  for (var i = 0; i < KINDS.length; i += 1) {
    var kind = KINDS[i];
    var read = await readAnchor(rpcUrl, signatures[kind], fetchImpl);

    if (read.kind !== kind) {
      throw new Aas2Error("anchor_wrong_kind", kind + " anchor carries a " + read.kind + " memo");
    }
    if (read.hash !== expected[kind]) {
      throw new Aas2Error("anchor_hash_mismatch", kind + " anchor does not commit to the receipt value");
    }

    anchors[kind] = read.anchor;
  }

  var validated = validateAnchorSet(anchors, expected);
  if (!validated.ok) {
    throw new Aas2Error("anchor_order_invalid", validated.errors.join("; "), {
      errors: validated.errors,
    });
  }

  return anchors;
}

module.exports = {
  MEMO_PROGRAM_ID: MEMO_PROGRAM_ID,
  MEMO_PREFIX: MEMO_PREFIX,
  KINDS: KINDS,
  memoFor: memoFor,
  parseMemo: parseMemo,
  validateAnchorSet: validateAnchorSet,
  readAnchor: readAnchor,
  readAnchorSet: readAnchorSet,
};
