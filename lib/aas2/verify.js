/**
 * lib/aas2/verify.js — the two directions that matter.
 *
 * `verifyOutput` turns an agreement and raw bytes into a signed receipt and a
 * private report. `verifyReceipt` takes those public artifacts and a third
 * party's assumptions and answers, step by step, whether the receipt holds up.
 * They are separate on purpose: the producer is allowed to be convenient, the
 * checker is not.
 *
 * `verifyReceipt` never returns a single boolean. A receipt can fail at the
 * signature while its hashes are perfect, or the reverse, and an operator
 * debugging that difference needs to see which step broke. `valid` is just
 * `steps.every(ok)`.
 *
 * The L3 ordering constraint is real and slightly awkward: the receipt anchor
 * commits to the receipt core hash, so it cannot exist before the receipt does.
 * `verifyOutput` therefore returns a receipt whose receipt anchor is still null,
 * plus the exact memo to anchor. `attachAnchors` validates the third anchor and
 * slot order, and is the only thing that makes the receipt final.
 */
"use strict";

var fs = require("node:fs");
var path = require("node:path");

var canonical = require("./canonical.js");
var checks = require("./checks.js");
var merkle = require("./merkle.js");
var keys = require("./keys.js");
var receiptLib = require("./receipt.js");
var anchorsLib = require("./anchors.js");

var Aas2Error = canonical.Aas2Error;

var RECEIPT_VERSION = "aas-2/0.1";
var DEFAULT_RULESET_URL = "https://www.equxi.tech/aas-2/rulesets/equxi-checks-0.1.0.json";
var DEFAULT_RULESET_PATH = path.join(__dirname, "..", "..", "aas-2", "rulesets", "equxi-checks-0.1.0.json");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
  try {
    return canonical.jcs(a) === canonical.jcs(b);
  } catch (error) {
    return false;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function isoFromBlockTime(seconds) {
  return new Date(seconds * 1000).toISOString();
}

/* ------------------------------------------------------------------ */
/* Ruleset                                                             */
/* ------------------------------------------------------------------ */

/**
 * Loads and hashes the ruleset document. The hash covers the document as
 * published, so a wording change is a new hash even when no code changed.
 */
function loadRuleset(input) {
  var document;

  if (isPlainObject(input)) {
    document = input;
  } else {
    var file = input || DEFAULT_RULESET_PATH;
    try {
      document = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Aas2Error("ruleset_unreadable", "cannot read ruleset at " + file + ": " + error.message);
    }
  }

  if (!isPlainObject(document) || document.id !== "equxi/checks" || !document.version) {
    throw new Aas2Error("ruleset_invalid", "ruleset must declare id equxi/checks and a version");
  }

  var listed = (document.checks || []).map(function (check) {
    return check && check.id;
  });

  checks.CHECK_IDS.forEach(function (id) {
    if (listed.indexOf(id) === -1) {
      throw new Aas2Error("ruleset_invalid", 'ruleset does not define check "' + id + '"');
    }
  });

  return {
    document: document,
    id: document.id,
    version: document.version,
    hash: canonical.hashJson(document),
    url: DEFAULT_RULESET_URL,
  };
}

/* ------------------------------------------------------------------ */
/* Agreement                                                           */
/* ------------------------------------------------------------------ */

function withoutSignatures(agreement) {
  var copy = {};
  Object.keys(agreement || {}).forEach(function (key) {
    if (key !== "signatures") copy[key] = agreement[key];
  });
  return copy;
}

function validateAgreement(agreement) {
  if (!isPlainObject(agreement)) {
    throw new Aas2Error("agreement_invalid", "agreement must be a JSON object");
  }
  if (agreement.v !== RECEIPT_VERSION) {
    throw new Aas2Error("agreement_invalid", "agreement.v must be " + RECEIPT_VERSION);
  }
  if (typeof agreement.id !== "string" || agreement.id === "") {
    throw new Aas2Error("agreement_invalid", "agreement.id is required");
  }
  if (typeof agreement.ruleset !== "string" || agreement.ruleset === "") {
    throw new Aas2Error("agreement_invalid", "agreement.ruleset is required");
  }

  var deliverable = agreement.deliverable;
  if (!isPlainObject(deliverable)) {
    throw new Aas2Error("agreement_invalid", "agreement.deliverable is required");
  }
  if (deliverable.kind !== "records" || deliverable.format !== "csv") {
    throw new Aas2Error("agreement_unsupported", "v0.1 supports records delivered as csv");
  }
  if (!Number.isInteger(deliverable.expected_count) || deliverable.expected_count < 1) {
    throw new Aas2Error("agreement_invalid", "deliverable.expected_count must be an integer >= 1");
  }
  if (!Array.isArray(deliverable.fields) || deliverable.fields.length === 0) {
    throw new Aas2Error("agreement_invalid", "deliverable.fields must be a non-empty array");
  }

  var seen = Object.create(null);
  deliverable.fields.forEach(function (field) {
    if (typeof field !== "string" || field === "") {
      throw new Aas2Error("agreement_invalid", "deliverable.fields must be non-empty strings");
    }
    if (seen[field]) {
      throw new Aas2Error("agreement_invalid", 'duplicate deliverable field "' + field + '"');
    }
    seen[field] = true;
  });

  checks.validateChecks(agreement.checks);
  return true;
}

function verifyAgreementSignatures(agreement) {
  var signatures = agreement && agreement.signatures;
  if (!isPlainObject(signatures)) {
    throw new Aas2Error("agreement_unsigned", "L2 and L3 require signed agreements (P1)");
  }

  var payload = withoutSignatures(agreement);

  ["customer", "provider"].forEach(function (party) {
    var entry = signatures[party];
    if (!isPlainObject(entry) || typeof entry.key !== "string" || typeof entry.sig !== "string") {
      throw new Aas2Error("agreement_unsigned", "the " + party + " signature is missing");
    }
    if (!keys.verify(entry.key, keys.DOMAINS.agreement, payload, entry.sig)) {
      throw new Aas2Error("agreement_bad_signature", "the " + party + " agreement signature is invalid");
    }
  });

  return true;
}

/* ------------------------------------------------------------------ */
/* Shared preparation                                                  */
/* ------------------------------------------------------------------ */

function prepare(agreement, output, rulesetInput, submittedAt) {
  validateAgreement(agreement);

  var ruleset = loadRuleset(rulesetInput);
  var expectedRuleset = ruleset.id + "@" + ruleset.version;
  if (agreement.ruleset !== expectedRuleset) {
    throw new Aas2Error(
      "ruleset_mismatch",
      "agreement names " + agreement.ruleset + " but the verifier loaded " + expectedRuleset
    );
  }

  var parsed = canonical.parseCsv(output, agreement.deliverable.fields);
  var records = canonical.canonicalRecords(agreement, parsed);

  if (records.length === 0) {
    throw new Aas2Error("empty_records", "an empty record set is invalid (AAS-2 §7)");
  }

  var run = checks.runChecks(agreement, records, submittedAt);
  var tree = merkle.buildTree(records, run.perRecord, ruleset.hash);

  return {
    ruleset: ruleset,
    parsed: parsed,
    records: records,
    run: run,
    tree: tree,
    hashes: {
      agreement: receiptLib.agreementHash(agreement),
      rawOutput: canonical.hashBytes(Buffer.isBuffer(output) ? output : Buffer.from(String(output), "utf8")),
      canonicalRecords: canonical.hashJson(records),
      merkleRoot: canonical.hashDigest(tree.root),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Producing a receipt                                                 */
/* ------------------------------------------------------------------ */

/**
 * Options:
 *   agreement, output, submittedAt, createdAt, evidenceLevel,
 *   verifierPrivateKey, ruleset, injectedClock,
 *   providerPublicKey, providerSignature,
 *   anchors: {agreement, output}            for L3
 *
 * Returns `{receipt, report, coreHash, pending}`. `pending` is present at L3
 * and names the memo that still has to be anchored.
 */
function verifyOutput(options) {
  var opts = options || {};
  var level = opts.evidenceLevel || "L1";

  if (["L1", "L2", "L3"].indexOf(level) === -1) {
    throw new Aas2Error("bad_evidence_level", "evidence level must be L1, L2, or L3");
  }
  if (!opts.verifierPrivateKey) {
    throw new Aas2Error("no_verifier_key", "a receipt must be signed by the verifier (P3)");
  }

  var submittedAt = opts.submittedAt;
  var injectedClock = opts.injectedClock === true;

  if (!submittedAt) {
    submittedAt = isoNow();
    injectedClock = false;
  }

  if (level === "L2" || level === "L3") {
    verifyAgreementSignatures(opts.agreement);
  }

  if (level === "L3") {
    if (!opts.anchors || !opts.anchors.agreement || !opts.anchors.output) {
      throw new Aas2Error("l3_needs_anchors", "L3 requires the agreement and output anchors");
    }
    if (!Number.isInteger(opts.anchors.output.block_time)) {
      throw new Aas2Error("l3_needs_block_time", "the output anchor has no block time");
    }

    // The receipt anchor cannot exist yet, so it gets the largest possible slot
    // here. That still proves the two anchors we do have are present, match
    // their memos, and are ordered before anything that comes later.
    var early = anchorsLib.validateAnchorSet(
      {
        agreement: opts.anchors.agreement,
        output: opts.anchors.output,
        receipt: { tx: "pending", slot: Number.MAX_SAFE_INTEGER },
      },
      {
        agreement: receiptLib.agreementHash(opts.agreement),
        output: canonical.hashBytes(
          Buffer.isBuffer(opts.output) ? opts.output : Buffer.from(String(opts.output), "utf8")
        ),
      }
    );

    if (!early.ok) {
      throw new Aas2Error("anchor_invalid", early.errors.join("; "), { errors: early.errors });
    }

    // At L3 the chain clock is the deadline clock, and the provider signs that
    // same value after the output anchor confirms (P15, AAS-2 §5.5).
    submittedAt = isoFromBlockTime(opts.anchors.output.block_time);
  }

  var prepared = prepare(opts.agreement, opts.output, opts.ruleset, submittedAt);
  var createdAt = opts.createdAt || isoNow();
  var ruleset = prepared.ruleset;

  var report = receiptLib.buildReport({
    agreementHash: prepared.hashes.agreement,
    rawOutputHash: prepared.hashes.rawOutput,
    canonicalRecordsHash: prepared.hashes.canonicalRecords,
    merkleRoot: prepared.hashes.merkleRoot,
    ruleset: { id: ruleset.id, version: ruleset.version, hash: ruleset.hash, url: ruleset.url },
    submittedAt: submittedAt,
    columns: { declared: opts.agreement.deliverable.fields.slice(), extra: prepared.parsed.extraColumns },
    summary: prepared.run.summary,
    checks: prepared.run.checks,
    records: prepared.records,
    perRecord: prepared.run.perRecord,
    leaves: prepared.tree.leaves.map(canonical.hashDigest),
    verdict: prepared.run.verdict,
    createdAt: createdAt,
  });

  var reportHash = canonical.hashJson(report);

  var core = receiptLib.buildCore({
    agreementHash: prepared.hashes.agreement,
    rawOutputHash: prepared.hashes.rawOutput,
    canonicalRecordsHash: prepared.hashes.canonicalRecords,
    merkleRoot: prepared.hashes.merkleRoot,
    ruleset: { id: ruleset.id, version: ruleset.version, hash: ruleset.hash, url: ruleset.url },
    evidenceLevel: level,
    submittedAt: submittedAt,
    summary: prepared.run.summary,
    checks: prepared.run.checks,
    verdict: prepared.run.verdict,
    reportHash: reportHash,
    limits: receiptLib.limitsFor(level, { submittedAt: submittedAt, injectedClock: injectedClock }),
    createdAt: createdAt,
  });

  var coreHash = receiptLib.coreHash(core);
  var signatures = receiptLib.signAll(core, reportHash, opts.verifierPrivateKey);

  var anchors = null;
  var pending = null;

  if (level === "L3") {
    anchors = { agreement: opts.anchors.agreement, output: opts.anchors.output, receipt: null };
    pending = { kind: "receipt", hash: coreHash, memo: anchorsLib.memoFor("receipt", coreHash) };
  }

  if (level === "L2" || level === "L3") {
    if (!opts.providerPublicKey || !opts.providerSignature) {
      throw new Aas2Error("provider_unsigned", "L2 and L3 require a provider submission signature (P2)");
    }

    var payload = receiptLib.submissionPayload({
      agreementHash: prepared.hashes.agreement,
      rawOutputHash: prepared.hashes.rawOutput,
      canonicalRecordsHash: prepared.hashes.canonicalRecords,
      submittedAt: submittedAt,
    });

    if (!keys.verify(opts.providerPublicKey, keys.DOMAINS.submission, payload, opts.providerSignature)) {
      throw new Aas2Error("provider_bad_signature", "the provider submission signature is invalid");
    }

    signatures.provider = {
      key: keys.publicKeyBase64(keys.publicKeyFrom(opts.providerPublicKey)),
      sig: opts.providerSignature,
    };
  }

  var receipt = Object.assign({}, core, { anchors: anchors, signatures: signatures });

  return { receipt: receipt, report: report, coreHash: coreHash, pending: pending };
}

/**
 * Attaches the third anchor and returns the final L3 receipt. Throws if the
 * memo does not commit to this receipt or the slots are not strictly ordered.
 */
function attachAnchors(receipt, anchors) {
  var coreHash = receiptLib.coreHash(receipt);
  var expected = {
    agreement: receipt.agreement,
    output: receipt.raw_output,
    receipt: coreHash,
  };

  var validated = anchorsLib.validateAnchorSet(anchors, expected);
  if (!validated.ok) {
    throw new Aas2Error("anchor_invalid", validated.errors.join("; "), { errors: validated.errors });
  }

  /* At L3 the deadline clock is the output anchor block time (P15), so a receipt
   * whose submitted_at disagrees with that anchor is claiming a clock it cannot
   * prove, even when every hash and slot is correct. */
  if (receipt.evidence_level === "L3") {
    var anchorClock = isoFromBlockTime(anchors.output.block_time);
    if (receipt.submitted_at !== anchorClock) {
      throw new Aas2Error(
        "anchor_invalid",
        "submitted_at " + receipt.submitted_at + " does not match the output anchor block time " + anchorClock
      );
    }
  }

  return Object.assign({}, receipt, {
    anchors: {
      agreement: anchors.agreement,
      output: anchors.output,
      receipt: anchors.receipt,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Verifying a receipt (AAS-2 §10)                                     */
/* ------------------------------------------------------------------ */

function submissionPayloadOf(receipt) {
  return receiptLib.submissionPayload({
    agreementHash: receipt.agreement,
    rawOutputHash: receipt.raw_output,
    canonicalRecordsHash: receipt.canonical_records,
    submittedAt: receipt.submitted_at,
  });
}

/**
 * Options: receipt, agreement, output, ruleset, verifierPublicKey,
 *          providerPublicKey, report, rpcUrl, fetchImpl
 *
 * Returns `{valid, steps}` where each step is `{id, ok, detail}`.
 */
async function verifyReceipt(options) {
  var opts = options || {};
  var receipt = opts.receipt;
  var steps = [];

  function add(id, ok, detail) {
    steps.push({ id: id, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  }

  /* 1. Shape cannot be assumed: an empty object is not a receipt. */
  if (!isPlainObject(receipt)) {
    add("shape", false, "receipt is not an object");
    return { valid: false, steps: steps };
  }

  var shapeProblems = [];
  if (receipt.v !== RECEIPT_VERSION) shapeProblems.push("wrong version");
  if (!Array.isArray(receipt.limits) || receipt.limits.length === 0) shapeProblems.push("limits missing (P9)");
  if (!Array.isArray(receipt.checks)) shapeProblems.push("checks missing");
  if (!isPlainObject(receipt.summary)) shapeProblems.push("summary missing");
  if (typeof receipt.submitted_at !== "string") shapeProblems.push("submitted_at missing");
  if (!isPlainObject(receipt.signatures) || !receipt.signatures.verifier) {
    shapeProblems.push("verifier signature missing");
  }

  add("shape", shapeProblems.length === 0, shapeProblems.join("; ") || null);
  if (shapeProblems.length) return { valid: false, steps: steps };

  var prepared;

  try {
    prepared = prepare(opts.agreement, opts.output, opts.ruleset, receipt.submitted_at);
  } catch (error) {
    add("inputs", false, error.message);
    return { valid: false, steps: steps };
  }

  /* 2. Agreement hash, from the document without signatures. */
  add(
    "agreement_hash",
    prepared.hashes.agreement === receipt.agreement,
    prepared.hashes.agreement === receipt.agreement
      ? null
      : "recomputed " + prepared.hashes.agreement + ", receipt says " + receipt.agreement
  );

  /* 3. Output hashes, raw and canonical. */
  var outputOk =
    prepared.hashes.rawOutput === receipt.raw_output &&
    prepared.hashes.canonicalRecords === receipt.canonical_records;
  add(
    "output_hashes",
    outputOk,
    outputOk
      ? null
      : "raw " + prepared.hashes.rawOutput + " / canonical " + prepared.hashes.canonicalRecords
  );

  /* 4. Rerun the ruleset and compare everything public. */
  var expectedChecks = prepared.run.checks.map(receiptLib.publicCheck);
  var checksOk =
    deepEqual(expectedChecks, receipt.checks) &&
    deepEqual(prepared.run.summary, receipt.summary) &&
    prepared.run.verdict === receipt.verdict &&
    prepared.hashes.merkleRoot === receipt.merkle_root;
  add("rerun", checksOk, checksOk ? null : "checks, summary, verdict, or merkle root differ");

  /* 5. The report, when the verifier holds it. */
  if (opts.report) {
    var reportHash = canonical.hashJson(opts.report);
    add(
      "report_hash",
      reportHash === receipt.report_hash,
      reportHash === receipt.report_hash ? null : "recomputed " + reportHash
    );
  } else {
    add("report_hash", true, "no report supplied; commit not recomputed");
  }

  /* 6. Verifier signature over the core hash. */
  var coreHash = receiptLib.coreHash(receipt);
  var verifierKey = opts.verifierPublicKey || (receipt.signatures.verifier && receipt.signatures.verifier.key);
  var verifierOk = keys.verify(verifierKey, keys.DOMAINS.receipt, coreHash, receipt.signatures.verifier.sig);
  add("verifier_signature", verifierOk, verifierOk ? null : "signature does not cover the receipt core");

  /* 7. Provider submission signature, for L2 and L3. */
  var level = receipt.evidence_level;
  if (level === "L2" || level === "L3") {
    var provider = receipt.signatures.provider;
    var providerOk =
      isPlainObject(provider) &&
      keys.verify(
        opts.providerPublicKey || provider.key,
        keys.DOMAINS.submission,
        submissionPayloadOf(receipt),
        provider.sig
      );
    add("provider_signature", providerOk, providerOk ? null : "submission signature is invalid");
  } else {
    add("provider_signature", true, "not applicable at L1");
  }

  /* 8. Anchors, structurally and optionally on-chain. */
  if (level === "L3") {
    var expectedAnchors = {
      agreement: receipt.agreement,
      output: receipt.raw_output,
      receipt: coreHash,
    };
    var anchorCheck = anchorsLib.validateAnchorSet(receipt.anchors, expectedAnchors);
    add("anchors", anchorCheck.ok, anchorCheck.ok ? null : anchorCheck.errors.join("; "));

    if (anchorCheck.ok) {
      var anchorClock = isoFromBlockTime(receipt.anchors.output.block_time);
      add(
        "submitted_at_clock",
        anchorClock === receipt.submitted_at,
        anchorClock === receipt.submitted_at
          ? null
          : "output anchor block time is " + anchorClock + ", receipt says " + receipt.submitted_at
      );
    }

    if (anchorCheck.ok && opts.rpcUrl) {
      try {
        var onChain = await anchorsLib.readAnchorSet(
          opts.rpcUrl,
          {
            agreement: receipt.anchors.agreement.tx,
            output: receipt.anchors.output.tx,
            receipt: receipt.anchors.receipt.tx,
          },
          expectedAnchors,
          opts.fetchImpl
        );
        add("anchors_on_chain", true, { slots: [onChain.agreement.slot, onChain.output.slot, onChain.receipt.slot] });
      } catch (error) {
        add("anchors_on_chain", false, error.message);
      }
    }
  } else {
    add("anchors", true, "not applicable below L3");
  }

  /* 9. Agreement signatures and the declared level. */
  if (level === "L2" || level === "L3") {
    try {
      verifyAgreementSignatures(opts.agreement);
      add("agreement_signatures", true, null);
    } catch (error) {
      add("agreement_signatures", false, error.message);
    }
  } else if (level === "L1") {
    add("agreement_signatures", true, "not required at L1");
  } else {
    add("evidence_level", false, "unknown evidence level: " + String(level));
  }

  /* 10. Limits must be present and say something. */
  add(
    "limits",
    Array.isArray(receipt.limits) && receipt.limits.length > 0,
    Array.isArray(receipt.limits) && receipt.limits.length > 0 ? null : "limits missing (P9)"
  );

  return { valid: steps.every(function (step) { return step.ok; }), steps: steps };
}

/* ------------------------------------------------------------------ */
/* Selective disclosure                                                */
/* ------------------------------------------------------------------ */

/** A proof that one record failed, without the other records. */
function proveRecord(options) {
  var submittedAt = options.submittedAt || isoNow();
  var prepared = prepare(options.agreement, options.output, options.ruleset, submittedAt);
  var index = options.index;

  if (!Number.isInteger(index) || index < 0 || index >= prepared.records.length) {
    throw new Aas2Error("bad_index", "record index out of range: " + index);
  }

  return {
    v: RECEIPT_VERSION,
    agreement: prepared.hashes.agreement,
    raw_output: prepared.hashes.rawOutput,
    canonical_records: prepared.hashes.canonicalRecords,
    submitted_at: submittedAt,
    ruleset: prepared.ruleset.hash,
    merkle_root: prepared.hashes.merkleRoot,
    index: index,
    record: prepared.records[index],
    checks: prepared.run.perRecord[index],
    leaf: canonical.hashDigest(prepared.tree.leaves[index]),
    proof: merkle.buildProof(prepared.tree, index),
  };
}

/**
 * Recomputes the leaf from the revealed record, its checks, and the ruleset
 * hash. A proof that ships a leaf but a different record proves nothing, so the
 * stated leaf is compared with the recomputed one rather than trusted.
 */
function verifyRecordProof(proofDocument) {
  var leaf = canonical.hashDigest(
    merkle.leafHash(proofDocument.record, proofDocument.checks, proofDocument.ruleset)
  );
  var leafMatches = !proofDocument.leaf || proofDocument.leaf === leaf;

  return {
    leaf: leaf,
    leaf_matches: leafMatches,
    ok: leafMatches && merkle.verifyProof(leaf, proofDocument.proof, proofDocument.merkle_root),
  };
}

module.exports = {
  RECEIPT_VERSION: RECEIPT_VERSION,
  DEFAULT_RULESET_URL: DEFAULT_RULESET_URL,
  DEFAULT_RULESET_PATH: DEFAULT_RULESET_PATH,
  isoNow: isoNow,
  loadRuleset: loadRuleset,
  validateAgreement: validateAgreement,
  verifyAgreementSignatures: verifyAgreementSignatures,
  withoutSignatures: withoutSignatures,
  verifyOutput: verifyOutput,
  attachAnchors: attachAnchors,
  verifyReceipt: verifyReceipt,
  proveRecord: proveRecord,
  verifyRecordProof: verifyRecordProof,
};
