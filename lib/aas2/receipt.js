/**
 * lib/aas2/receipt.js — the document a third party can check without trusting us.
 *
 * The receipt is public, so it never carries a record value. The private report
 * carries the values and is committed to by `report_hash`; a party who holds the
 * report can prove it is the one the verifier issued without publishing a row.
 *
 * The core is everything except `anchors` and `signatures`, which is exactly the
 * part that must be identical for two receipts to be the same receipt (P14).
 * Keeping anchors out means the same verdict can be re-anchored without
 * changing its identity, and keeping signatures out is what stops the signature
 * from covering itself.
 */
"use strict";

var crypto = require("node:crypto");
var canonical = require("./canonical.js");
var keys = require("./keys.js");

var hashJson = canonical.hashJson;
var Aas2Error = canonical.Aas2Error;

var RECEIPT_VERSION = "aas-2/0.1";

/** Agreement hash covers the document without its signatures (§6.5). */
function agreementHash(agreement) {
  var copy = {};
  Object.keys(agreement || {}).forEach(function (key) {
    if (key !== "signatures") copy[key] = agreement[key];
  });
  return hashJson(copy);
}

/** The payload the provider signs at submission time (§8.1). */
function submissionPayload(input) {
  return {
    agreement: input.agreementHash,
    raw_output: input.rawOutputHash,
    canonical_records: input.canonicalRecordsHash,
    submitted_at: input.submittedAt,
  };
}

/** Strips the fields the public receipt must not contain. */
function publicCheck(result) {
  var out = {
    id: result.id,
    passed: result.passed,
    failed_count: result.failed_count,
  };
  if (result.details && Object.keys(result.details).length) out.details = result.details;
  return out;
}

/** Keeps the values, for the private report only. */
function reportCheck(result) {
  var out = {
    id: result.id,
    passed: result.passed,
    failed_count: result.failed_count,
  };
  var details = result.privateDetails || result.details;
  if (details && Object.keys(details).length) out.details = details;
  return out;
}

function limitsFor(evidenceLevel, options) {
  var opts = options || {};
  var limits = [
    "Checks are limited to the published ruleset; they do not prove factual accuracy.",
    "The receipt binds the submitted output hash; it does not prove which model or process produced it.",
    "A failed check is a verification result, not a legal breach.",
  ];

  if (evidenceLevel === "L3") {
    limits.push("Deadline used the output anchor block time.");
  } else if (evidenceLevel === "L2") {
    limits.push("The submission timestamp is provider-asserted, not chain-verified.");
    limits.push("No agreement/output/receipt ordering is claimed at L2.");
  } else {
    limits.push(
      opts.injectedClock
        ? "Deadline used an injected verifier clock (" + opts.submittedAt + "), not a chain time."
        : "Deadline used the verifier clock at verification time, not a chain time."
    );
    limits.push("No provider attestation and no anchor ordering are claimed at L1.");
  }

  limits.push("Record indices are zero-based.");
  return limits;
}

function buildReport(input) {
  return {
    v: RECEIPT_VERSION,
    agreement: input.agreementHash,
    raw_output: input.rawOutputHash,
    canonical_records: input.canonicalRecordsHash,
    merkle_root: input.merkleRoot,
    ruleset: input.ruleset,
    submitted_at: input.submittedAt,
    columns: input.columns,
    summary: input.summary,
    checks: input.checks.map(reportCheck),
    records: input.records.map(function (record, index) {
      return {
        index: index,
        record: record,
        checks: input.perRecord[index] || {},
        leaf: input.leaves[index],
      };
    }),
    verdict: input.verdict,
    created_at: input.createdAt,
  };
}

function buildCore(input) {
  return {
    v: RECEIPT_VERSION,
    agreement: input.agreementHash,
    raw_output: input.rawOutputHash,
    canonical_records: input.canonicalRecordsHash,
    merkle_root: input.merkleRoot,
    ruleset: input.ruleset,
    evidence_level: input.evidenceLevel,
    submitted_at: input.submittedAt,
    summary: input.summary,
    checks: input.checks.map(publicCheck),
    verdict: input.verdict,
    report_hash: input.reportHash,
    limits: input.limits,
    created_at: input.createdAt,
  };
}

function coreOf(receipt) {
  var core = {};
  Object.keys(receipt).forEach(function (key) {
    if (key === "anchors" || key === "signatures") return;
    core[key] = receipt[key];
  });
  return core;
}

function coreHash(coreOrReceipt) {
  return hashJson(coreOf(coreOrReceipt));
}

/**
 * Signs the core hash with the verifier key and, when a verifier key is present,
 * the report hash with the same key under its own domain. The report signature
 * is how a party proves the report they hold is the one that was issued.
 */
function signAll(core, reportHash, privateKey) {
  if (!privateKey) {
    throw new Aas2Error("no_verifier_key", "a receipt must be signed by the verifier (P3)");
  }

  var publicKey = keys.publicKeyBase64(crypto.createPublicKey(privateKey));
  var receiptPayload = coreHash(core);

  return {
    verifier: {
      key: publicKey,
      sig: keys.sign(privateKey, keys.DOMAINS.receipt, receiptPayload),
    },
    report: {
      key: publicKey,
      sig: keys.sign(privateKey, keys.DOMAINS.report, reportHash),
    },
  };
}

module.exports = {
  RECEIPT_VERSION: RECEIPT_VERSION,
  agreementHash: agreementHash,
  submissionPayload: submissionPayload,
  publicCheck: publicCheck,
  reportCheck: reportCheck,
  limitsFor: limitsFor,
  buildReport: buildReport,
  buildCore: buildCore,
  coreOf: coreOf,
  coreHash: coreHash,
  signAll: signAll,
};
