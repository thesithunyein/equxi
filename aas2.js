#!/usr/bin/env node
/**
 * aas2.js — the reference path from bytes to a receipt.
 *
 * The spec says the CLI is the reference and the API wraps it, so the CLI does
 * the whole job with no server and no wallet:
 *
 *   node aas2.js keygen --out .aas2
 *   node aas2.js verify --agreement fixtures/aas-2/agreement.product-feed.json \
 *     --output fixtures/aas-2/output.product-feed.csv \
 *     --submitted-at 2026-11-15T10:00:00Z --now 2026-11-15T10:00:00Z \
 *     --key .aas2/aas2-verifier.pem --out receipt.json --report-out report.json
 *   node aas2.js verify-receipt --receipt receipt.json --agreement ... \
 *     --output ... --verifier-key .aas2/aas2-verifier.pub.json
 *   node aas2.js prove --agreement ... --output ... --index 3
 *   node aas2.js check-proof --proof proof.json
 *
 * Exit codes: 0 success, 1 verification failed, 2 usage, 3 incomplete (an L3
 * receipt waiting for its receipt anchor).
 */
"use strict";

var fs = require("node:fs");
var path = require("node:path");

var canonical = require("./lib/aas2/canonical.js");
var keys = require("./lib/aas2/keys.js");
var anchorsLib = require("./lib/aas2/anchors.js");
var verifyLib = require("./lib/aas2/verify.js");

var EXIT_OK = 0;
var EXIT_FAIL = 1;
var EXIT_USAGE = 2;
var EXIT_PENDING = 3;

function parseArgs(argv) {
  var args = { _: [] };

  for (var i = 0; i < argv.length; i += 1) {
    var token = argv[i];
    if (token.indexOf("--") !== 0) {
      args._.push(token);
      continue;
    }

    var key = token.slice(2);
    var equals = key.indexOf("=");
    if (equals !== -1) {
      args[key.slice(0, equals)] = key.slice(equals + 1);
      continue;
    }

    var next = argv[i + 1];
    if (next !== undefined && next.indexOf("--") !== 0) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

function usage() {
  console.log(
    [
      "AAS-2 reference verifier",
      "",
      "  node aas2.js keygen --out <dir>",
      "  node aas2.js verify --agreement <file> --output <file> [options]",
      "  node aas2.js verify-receipt --receipt <file> --agreement <file> --output <file> [options]",
      "  node aas2.js prove --agreement <file> --output <file> --index <n> [options]",
      "  node aas2.js check-proof --proof <file>",
      "  node aas2.js attach --receipt <file> --anchor <file> [--out <file>]",
      "  node aas2.js hash --file <file> | --agreement <file> | --ruleset <file>",
      "",
      "verify options",
      "  --submitted-at <rfc3339>   provider timestamp; defaults to now",
      "  --now <rfc3339>            receipt createdAt; defaults to now",
      "  --level <L1|L2|L3>         evidence level; default L1",
      "  --key <pem>                verifier private key (PKCS#8)",
      "  --ephemeral                generate a throwaway key (demo only)",
      "  --provider-key <base64>    provider public key, for L2 and L3",
      "  --provider-sig <file>      provider submission signature, for L2 and L3",
      "  --anchors <file>           agreement and output anchors, for L3",
      "  --ruleset <file>           ruleset document; defaults to the bundled 0.1.0",
      "  --out <file>               write the receipt",
      "  --report-out <file>        write the private report",
      "  --json                     print the full receipt",
      "",
      "verify-receipt options",
      "  --verifier-key <pem|base64> --provider-key <pem|base64> --report <file> --rpc <url>",
      "",
      "attach options",
      "  --anchor <file>            the receipt anchor {tx, slot, block_time, memo}",
    ].join("\n")
  );
}

function fail(message) {
  console.error("error: " + message);
  process.exit(EXIT_USAGE);
}

function readFile(file, label) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    fail("cannot read " + (label || "file") + " " + file + ": " + error.message);
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail("cannot parse " + (label || "JSON file") + " " + file + ": " + error.message);
  }
}

function writeJson(file, value, mode) {
  var target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + "\n", { mode: mode || 0o644 });
  return target;
}

/** Accepts a path or a literal key, because both get pasted into shells. */
function keyArg(value) {
  if (value === undefined) return undefined;
  try {
    if (fs.existsSync(value)) return fs.readFileSync(value, "utf8");
  } catch (error) {
    // A base64 key can contain characters a filesystem rejects; fall through.
  }
  return value;
}

/** Also accepts the `.pub.json` that `keygen` writes. */
function publicKeyArg(value) {
  var raw = keyArg(value);
  if (typeof raw !== "string") return raw;

  var trimmed = raw.trim();
  if (trimmed.charAt(0) === "{") {
    try {
      var parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.public_key === "string") return parsed.public_key;
    } catch (error) {
      // Not our JSON; let the key parser give the real error.
    }
  }

  return raw;
}

function printSummary(result, extras) {
  var receipt = result.receipt;
  var summary = receipt.summary;

  console.log("receipt   " + result.coreHash);
  console.log("agreement " + receipt.agreement);
  console.log("output    " + receipt.raw_output);
  console.log("records   " + summary.received + " received, " + summary.passed_records + " passed, " + summary.failed_record_count + " failed");
  if (summary.failed_records.length) console.log("failed    [" + summary.failed_records.join(", ") + "]");
  console.log("verdict   " + receipt.verdict);
  console.log("level     " + receipt.evidence_level);

  receipt.checks.forEach(function (check) {
    console.log("  " + (check.passed ? "PASS" : "FAIL") + "  " + check.id);
  });

  if (extras && extras.reportPath) console.log("report    " + extras.reportPath);
  if (extras && extras.receiptPath) console.log("written   " + extras.receiptPath);
  if (extras && extras.pending) {
    console.log("");
    console.log("pending receipt anchor (send this memo, then run attach):");
    console.log("  " + extras.pending.memo);
  }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

function cmdKeygen(args) {
  var outDir = path.resolve(args.out || ".aas2");
  var pair = keys.generateKeyPair();
  var publicKey = keys.publicKeyBase64(pair.publicKey);

  fs.mkdirSync(outDir, { recursive: true });
  var privatePath = path.join(outDir, "aas2-verifier.pem");
  fs.writeFileSync(
    privatePath,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 }
  );

  var publicPath = writeJson(path.join(outDir, "aas2-verifier.pub.json"), {
    alg: "ed25519",
    public_key: publicKey,
    note: "Publish this key. The matching private key must never be committed.",
  });

  console.log("private   " + privatePath);
  console.log("public    " + publicPath);
  console.log("key       " + publicKey);
  return EXIT_OK;
}

function cmdVerify(args) {
  if (!args.agreement || !args.output) fail("--agreement and --output are required");

  var agreement = readJson(args.agreement, "agreement");
  var output = readFile(args.output, "output");

  var privateKey;
  if (args.key) {
    privateKey = keys.privateKeyFromPem(keyArg(args.key));
  } else if (args.ephemeral) {
    privateKey = keys.generateKeyPair().privateKey;
    console.error("warning: ephemeral signing key; this receipt is not publishable as-is");
  } else {
    fail("--key is required to sign a receipt, or pass --ephemeral for a demo");
  }

  var providerSignature;
  if (args["provider-sig"]) {
    var rawSig = fs.readFileSync(args["provider-sig"], "utf8").trim();
    providerSignature = rawSig;
  }

  var result = verifyLib.verifyOutput({
    agreement: agreement,
    output: output,
    submittedAt: args["submitted-at"],
    createdAt: args.now,
    evidenceLevel: args.level || "L1",
    verifierPrivateKey: privateKey,
    providerPublicKey: args["provider-key"],
    providerSignature: providerSignature,
    anchors: args.anchors ? readJson(args.anchors, "anchors") : undefined,
    ruleset: args.ruleset,
    injectedClock: Boolean(args["submitted-at"]),
  });

  var extras = { pending: result.pending || null };

  if (args["report-out"]) {
    extras.reportPath = writeJson(args["report-out"], result.report);
  }

  if (args.out) {
    extras.receiptPath = writeJson(args.out, result.receipt);
  }

  if (args.json) {
    console.log(JSON.stringify({ receipt: result.receipt, report: result.report, core_hash: result.coreHash, pending: result.pending }, null, 2));
  } else {
    printSummary(result, extras);
  }

  return result.pending ? EXIT_PENDING : EXIT_OK;
}

async function cmdVerifyReceipt(args) {
  if (!args.receipt || !args.agreement || !args.output) {
    fail("--receipt, --agreement, and --output are required");
  }

  var receipt = readJson(args.receipt, "receipt");
  var result = await verifyLib.verifyReceipt({
    receipt: receipt,
    agreement: readJson(args.agreement, "agreement"),
    output: readFile(args.output, "output"),
    ruleset: args.ruleset,
    verifierPublicKey: publicKeyArg(args["verifier-key"]),
    providerPublicKey: publicKeyArg(args["provider-key"]),
    report: args.report ? readJson(args.report, "report") : undefined,
    rpcUrl: args.rpc,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    result.steps.forEach(function (step) {
      console.log((step.ok ? "PASS  " : "FAIL  ") + step.id + (step.detail ? "  " + JSON.stringify(step.detail) : ""));
    });
    console.log("");
    console.log(result.valid ? "VALID" : "INVALID");
  }

  return result.valid ? EXIT_OK : EXIT_FAIL;
}

function cmdProve(args) {
  if (!args.agreement || !args.output || args.index === undefined) {
    fail("--agreement, --output, and --index are required");
  }

  var index = Number(args.index);
  if (!Number.isInteger(index)) fail("--index must be an integer");

  var proof = verifyLib.proveRecord({
    agreement: readJson(args.agreement, "agreement"),
    output: readFile(args.output, "output"),
    index: index,
    submittedAt: args["submitted-at"],
    ruleset: args.ruleset,
  });

  if (args.out) console.log("written   " + writeJson(args.out, proof));
  else console.log(JSON.stringify(proof, null, 2));

  return EXIT_OK;
}

function cmdCheckProof(args) {
  if (!args.proof) fail("--proof is required");

  var proof = readJson(args.proof, "proof");
  var result = verifyLib.verifyRecordProof(proof);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("record  " + proof.index);
    console.log("leaf    " + result.leaf);
    console.log("bound   " + (result.leaf_matches ? "yes" : "no"));
    console.log(result.ok ? "VALID" : "INVALID");
  }

  return result.ok ? EXIT_OK : EXIT_FAIL;
}

function cmdAttach(args) {
  if (!args.receipt || !args.anchor) fail("--receipt and --anchor are required");

  var receipt = readJson(args.receipt, "receipt");
  var anchor = readJson(args.anchor, "anchor");
  var final;

  try {
    final = verifyLib.attachAnchors(receipt, {
      agreement: receipt.anchors && receipt.anchors.agreement,
      output: receipt.anchors && receipt.anchors.output,
      receipt: anchor,
    });
  } catch (error) {
    console.error("error: " + error.message);
    return EXIT_FAIL;
  }

  if (args.out) console.log("written   " + writeJson(args.out, final));
  else console.log(JSON.stringify(final, null, 2));

  return EXIT_OK;
}

function cmdHash(args) {
  if (args.agreement) {
    console.log(canonical.hashJson(verifyLib.withoutSignatures(readJson(args.agreement, "agreement"))));
    return EXIT_OK;
  }

  if (args.ruleset) {
    var ruleset = verifyLib.loadRuleset(args.ruleset);
    console.log(ruleset.hash);
    return EXIT_OK;
  }

  if (args.file) {
    console.log(canonical.hashBytes(readFile(args.file)));
    return EXIT_OK;
  }

  fail("pass --file, --agreement, or --ruleset");
}

async function main() {
  var args = parseArgs(process.argv.slice(2));
  var command = args._[0];

  if (!command || command === "help" || args.help) {
    usage();
    return EXIT_OK;
  }

  try {
    if (command === "keygen") return cmdKeygen(args);
    if (command === "verify") return cmdVerify(args);
    if (command === "verify-receipt") return await cmdVerifyReceipt(args);
    if (command === "prove") return cmdProve(args);
    if (command === "check-proof") return cmdCheckProof(args);
    if (command === "attach") return cmdAttach(args);
    if (command === "hash") return cmdHash(args);
  } catch (error) {
    console.error("error: " + error.message);
    if (process.env.AAS2_DEBUG) console.error(error.stack);
    return EXIT_FAIL;
  }

  usage();
  return EXIT_USAGE;
}

main().then(function (code) {
  process.exit(code);
});
