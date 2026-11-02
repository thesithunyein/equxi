/**
 * `POST /api/verify` — agreement plus bytes in, signed receipt out.
 *
 * Stateless by design (AAS-2 §16): nothing is stored, so a verification leaves
 * no customer data behind and a cold start costs nothing. The caller keeps the
 * receipt and the private report; this endpoint keeps neither.
 *
 * The same code path as the CLI (`lib/aas2/verify.js`) runs here, which is the
 * point. An API that reimplements the ruleset would be a second implementation
 * to audit and a second place for the two to drift.
 *
 * ## Why this returns 503 without a key
 *
 * A receipt must be signed by the verifier (P3). An unsigned document is not a
 * receipt, and returning one with a `200` would invite someone to treat it as
 * one. So an unconfigured deployment refuses the work instead of pretending.
 * Set `EQUXI_AAS2_VERIFIER_KEY` to a PKCS#8 Ed25519 PEM (or its base64) and the
 * endpoint signs.
 *
 * L3 is not offered here. Anchoring needs a wallet and three ordered slots, and
 * a stateless function has neither. The CLI does L3; this endpoint caps at L2
 * and says so.
 *
 * Request:
 *   {
 *     "agreement": {...},
 *     "output": "<csv text>" | "<base64>",
 *     "output_encoding": "utf8" | "base64",
 *     "submitted_at": "<rfc3339>",     // optional; defaults to now
 *     "created_at": "<rfc3339>",       // optional; defaults to now
 *     "evidence_level": "L1" | "L2",   // default L1
 *     "provider_public_key": "<base64>",
 *     "provider_signature": "<base64>"
 *   }
 *
 * Response: { ok, core_hash, verifier, receipt, report }
 */
"use strict";

var keys = require("../lib/aas2/keys.js");
var verifyLib = require("../lib/aas2/verify.js");
var canonical = require("../lib/aas2/canonical.js");
var throttle = require("../lib/rate-limit.js");
var log = require("../lib/log.js");

// Statically required so the serverless bundle carries the ruleset. The
// library's default is a filesystem path, which tracing cannot see.
var RULESET = require("../aas-2/rulesets/equxi-checks-0.1.0.json");

var MAX_BODY_BYTES = 2 * 1024 * 1024;

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

/** Returns `{key}` on success, `{error}` on a malformed key, or null. */
function verifierKey() {
  var raw = process.env.EQUXI_AAS2_VERIFIER_KEY;
  if (!raw) return null;

  var pem = raw.indexOf("BEGIN") !== -1 ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");

  try {
    return { key: keys.privateKeyFromPem(pem) };
  } catch (error) {
    return { error: error.message };
  }
}

function outputBytes(body) {
  if (typeof body.output !== "string") {
    throw Object.assign(new Error("output must be a string"), { status: 400 });
  }
  if (body.output_encoding === "base64") {
    return Buffer.from(body.output, "base64");
  }
  return Buffer.from(body.output, "utf8");
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
    return send(res, 405, { ok: false, error: "method not allowed; use POST" });
  }

  if (throttle.limited(req)) {
    return send(res, 429, { ok: false, error: "too many requests" });
  }

  log.track("aas2_verify", req, res);

  var configured = verifierKey();
  if (!configured) {
    return send(res, 503, {
      ok: false,
      error: "verifier_key_not_configured",
      detail:
        "AAS-2 receipts must be signed (P3). Set EQUXI_AAS2_VERIFIER_KEY to a PKCS#8 Ed25519 PEM, or its base64. Run `node aas2.js keygen --out .aas2` to create one.",
    });
  }
  if (configured.error) {
    return send(res, 503, { ok: false, error: "verifier_key_invalid", detail: configured.error });
  }

  var body;
  try {
    var raw = await readBody(req);
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch (error) {
    return send(res, error.status || 400, { ok: false, error: "invalid_body", detail: error.message });
  }

  if (!body || typeof body !== "object") {
    return send(res, 400, { ok: false, error: "invalid_body", detail: "body must be a JSON object" });
  }

  var level = body.evidence_level || "L1";
  if (level === "L3") {
    return send(res, 400, {
      ok: false,
      error: "l3_not_available_over_api",
      detail: "L3 needs three ordered anchors. Use `node aas2.js verify --level L3 --anchors ...`.",
    });
  }
  if (level !== "L1" && level !== "L2") {
    return send(res, 400, { ok: false, error: "bad_evidence_level", detail: "use L1 or L2" });
  }

  try {
    var result = verifyLib.verifyOutput({
      agreement: body.agreement,
      output: outputBytes(body),
      ruleset: RULESET,
      submittedAt: body.submitted_at,
      createdAt: body.created_at,
      evidenceLevel: level,
      verifierPrivateKey: configured.key,
      providerPublicKey: body.provider_public_key,
      providerSignature: body.provider_signature,
      injectedClock: Boolean(body.submitted_at),
    });

    return send(res, 200, {
      ok: true,
      core_hash: result.coreHash,
      verifier: { key: result.receipt.signatures.verifier.key },
      receipt: result.receipt,
      report: result.report,
    });
  } catch (error) {
    var status = error instanceof canonical.Aas2Error ? 400 : 500;
    return send(res, status, {
      ok: false,
      error: error.code || "verification_failed",
      detail: error.message,
    });
  }
};
