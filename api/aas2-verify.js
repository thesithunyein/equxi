/**
 * `POST /api/aas2-verify` — check a receipt that already exists.
 *
 * `/api/verify` issues receipts. This endpoint does the opposite: it takes a
 * receipt, the agreement it names, and the delivered bytes, and reruns every
 * check. That is the workflow a buyer actually has — a file arrives, and the
 * question is whether it matches what was signed.
 *
 * Stateless, like the rest of AAS-2 (AAS-2 §16). Nothing is stored, so a
 * verification leaves no customer data behind.
 *
 * ## Why a receipt is not a report
 *
 * The report is the verifier's private detail: which record failed and why.
 * The receipt only commits to it by hash. A caller that holds the report can
 * send it and have that commitment checked; a caller that does not still gets a
 * full verification of the receipt. The step list says which case applied.
 *
 * ## Cluster is a name, never a URL
 *
 * `cluster` is one of `offline`, `devnet`, or `mainnet`. An arbitrary RPC URL
 * would make this endpoint fetch whatever a stranger asked for, from inside the
 * deployment's network. The map below is the whole set of places it will read.
 *
 * Request:
 *   {
 *     "receipt": {...} | "<json>",
 *     "agreement": {...} | "<json>",
 *     "output": "<csv text>" | "<base64>",
 *     "output_encoding": "utf8" | "base64",
 *     "report": {...} | "<json>",          // optional
 *     "cluster": "offline" | "devnet" | "mainnet"
 *   }
 *
 * Response:
 *   { ok, valid, core_hash, evidence_level, cluster, identity, steps }
 */
"use strict";

var verifyLib = require("../lib/aas2/verify.js");
var receiptLib = require("../lib/aas2/receipt.js");
var throttle = require("../lib/rate-limit.js");
var log = require("../lib/log.js");

// A static require, not a filesystem read: the serverless bundler traces this
// file and ships the ruleset with the function. A path read at runtime is not
// guaranteed to make the trip.
var RULESET = require("../aas-2/rulesets/equxi-checks-0.1.0.json");
var VERIFIER_REGISTRY = require("../.well-known/equxi-verifier.json");

var MAX_BODY_BYTES = 2 * 1024 * 1024;
var MAX_OUTPUT_BYTES = 1536 * 1024;

var CLUSTER_RPC = {
  offline: null,
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body !== undefined) {
      if (Buffer.isBuffer(req.body)) return resolve(req.body);
      if (typeof req.body === "string") return resolve(Buffer.from(req.body, "utf8"));
      return resolve(Buffer.from(JSON.stringify(req.body), "utf8"));
    }

    var chunks = [];
    var size = 0;

    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/**
 * Accepts either a parsed object or the text of a file. A browser reading a
 * file has text; a script has an object. Both are the same document.
 */
function documentField(value, name) {
  if (value === undefined || value === null) return undefined;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw Object.assign(new Error(name + " is not valid JSON: " + error.message), { status: 400 });
    }
  }

  if (typeof value === "object") return value;

  throw Object.assign(new Error(name + " must be a JSON object or string"), { status: 400 });
}

function outputBytes(body) {
  if (typeof body.output !== "string") {
    throw Object.assign(new Error("output must be a string"), { status: 400 });
  }

  var bytes =
    body.output_encoding === "base64"
      ? Buffer.from(body.output, "base64")
      : Buffer.from(body.output, "utf8");

  if (bytes.length === 0) {
    throw Object.assign(new Error("output is empty"), { status: 400 });
  }
  if (bytes.length > MAX_OUTPUT_BYTES) {
    throw Object.assign(new Error("output is too large"), { status: 413 });
  }

  return bytes;
}

/** Which published identity signed this receipt, if any. */
function identityOf(receipt) {
  var key = receipt && receipt.signatures && receipt.signatures.verifier && receipt.signatures.verifier.key;
  if (!key) return null;

  var match = (VERIFIER_REGISTRY.keys || []).filter(function (entry) {
    return entry.public_key === key;
  })[0];

  if (!match) {
    return { known: false, key: key, key_id: null, status: null, issuer: null };
  }

  return {
    known: true,
    key: key,
    key_id: match.key_id || null,
    status: match.status || null,
    issuer: VERIFIER_REGISTRY.issuer || null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "POST, OPTIONS");
    return send(res, 405, { ok: false, error: "method_not_allowed", detail: "use POST" });
  }

  if (throttle.limited(req)) {
    return send(res, 429, { ok: false, error: "too_many_requests" });
  }

  log.track("aas2_verify_receipt", req, res);

  var body;
  try {
    var raw = await readBody(req);
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch (error) {
    return send(res, error.status || 400, {
      ok: false,
      error: "invalid_body",
      detail: error.message,
    });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return send(res, 400, {
      ok: false,
      error: "invalid_body",
      detail: "body must be a JSON object",
    });
  }

  var cluster = body.cluster === undefined ? "offline" : body.cluster;
  if (!Object.prototype.hasOwnProperty.call(CLUSTER_RPC, cluster)) {
    return send(res, 400, {
      ok: false,
      error: "bad_cluster",
      detail: "use offline, devnet, or mainnet",
    });
  }

  var receipt;
  var agreement;
  var report;
  var output;

  try {
    receipt = documentField(body.receipt, "receipt");
    agreement = documentField(body.agreement, "agreement");
    report = documentField(body.report, "report");
    output = outputBytes(body);
  } catch (error) {
    return send(res, error.status || 400, {
      ok: false,
      error: "invalid_input",
      detail: error.message,
    });
  }

  if (!receipt) {
    return send(res, 400, { ok: false, error: "missing_receipt", detail: "receipt is required" });
  }
  if (!agreement) {
    return send(res, 400, { ok: false, error: "missing_agreement", detail: "agreement is required" });
  }

  var started = Date.now();

  try {
    var result = await verifyLib.verifyReceipt({
      receipt: receipt,
      agreement: agreement,
      output: output,
      report: report,
      ruleset: RULESET,
      rpcUrl: CLUSTER_RPC[cluster],
    });

    var passed = result.steps.filter(function (step) {
      return step.ok;
    }).length;

    var coreHash = null;
    try {
      coreHash = receiptLib.coreHash(receipt);
    } catch (error) {
      coreHash = null;
    }

    return send(res, 200, {
      ok: true,
      valid: result.valid,
      core_hash: coreHash,
      evidence_level: receipt.evidence_level || null,
      cluster: cluster,
      identity: identityOf(receipt),
      passed: passed,
      total: result.steps.length,
      elapsed_ms: Date.now() - started,
      steps: result.steps,
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error: error.code || "verification_failed",
      detail: error.message,
    });
  }
};
