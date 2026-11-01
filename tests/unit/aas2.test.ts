/**
 * AAS-2 reference verifier tests — no network, no wallet, no chain.
 *
 * The fixture is the contract: `fixtures/aas-2/expected.json` pins the failed
 * records and every content hash, and the first test here fails if the
 * implementation drifts from it by one byte. The rest of the suite attacks the
 * parts a fixture cannot express: Merkle proofs, domain separation, evidence
 * levels, anchor ordering, and the API's refusal to issue an unsigned receipt.
 *
 * The libraries ship as CommonJS without `.d.ts` files, so they are required as
 * `any`. These tests are about behavior, not about the shape of the types.
 */
const { expect } = require("chai");

const fs = require("node:fs");
const path = require("node:path");

const canonical = require("../../lib/aas2/canonical.js");
const checks = require("../../lib/aas2/checks.js");
const merkle = require("../../lib/aas2/merkle.js");
const keys = require("../../lib/aas2/keys.js");
const receiptLib = require("../../lib/aas2/receipt.js");
const anchorsLib = require("../../lib/aas2/anchors.js");
const verifyLib = require("../../lib/aas2/verify.js");
const verifyHandler = require("../../api/verify.js");

const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "aas-2");
const FIXTURE_CLOCK = "2026-11-15T10:00:00Z";

type AnyJson = any;

function readJson(file: string): AnyJson {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
}

function fixture() {
  return {
    agreement: readJson("agreement.product-feed.json"),
    output: fs.readFileSync(path.join(FIXTURES, "output.product-feed.csv")),
    expected: readJson("expected.json"),
  };
}

const pair = keys.generateKeyPair();

function buildL1(overrides: AnyJson = {}) {
  const { agreement, output } = fixture();
  return verifyLib.verifyOutput(
    Object.assign(
      {
        agreement,
        output,
        submittedAt: FIXTURE_CLOCK,
        createdAt: FIXTURE_CLOCK,
        evidenceLevel: "L1",
        verifierPrivateKey: pair.privateKey,
        injectedClock: true,
      },
      overrides
    )
  );
}

function signedAgreement(source: AnyJson) {
  const agreement = JSON.parse(JSON.stringify(source));
  const customer = keys.generateKeyPair();
  const provider = keys.generateKeyPair();
  const payload = verifyLib.withoutSignatures(agreement);

  agreement.signatures = {
    customer: {
      key: keys.publicKeyBase64(customer.publicKey),
      sig: keys.sign(customer.privateKey, keys.DOMAINS.agreement, payload),
    },
    provider: {
      key: keys.publicKeyBase64(provider.publicKey),
      sig: keys.sign(provider.privateKey, keys.DOMAINS.agreement, payload),
    },
  };

  return { agreement, customer, provider };
}

function submissionSignature(provider: AnyJson, agreement: AnyJson, output: Buffer, submittedAt: string) {
  const parsed = canonical.parseCsv(output, agreement.deliverable.fields);
  const records = canonical.canonicalRecords(agreement, parsed);

  return keys.sign(
    provider.privateKey,
    keys.DOMAINS.submission,
    receiptLib.submissionPayload({
      agreementHash: receiptLib.agreementHash(agreement),
      rawOutputHash: canonical.hashBytes(output),
      canonicalRecordsHash: canonical.hashJson(records),
      submittedAt,
    })
  );
}

function threeRecords() {
  const records = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const perRecord = [
    { unique: true },
    { unique: true },
    { unique: false },
  ];
  const ruleset = canonical.hashJson({ id: "test", version: "0" });
  return { records, perRecord, ruleset, tree: merkle.buildTree(records, perRecord, ruleset) };
}

/* ── fixture ─────────────────────────────────────────────────────────── */

describe("AAS-2 fixture: product feed", () => {
  it("reproduces every pinned hash", () => {
    const { expected } = fixture();
    const result = buildL1();

    expect(result.receipt.agreement).to.equal(expected.hashes.agreement);
    expect(result.receipt.raw_output).to.equal(expected.hashes.raw_output);
    expect(result.receipt.canonical_records).to.equal(expected.hashes.canonical_records);
    expect(result.receipt.merkle_root).to.equal(expected.hashes.merkle_root);
    expect(result.receipt.ruleset.hash).to.equal(expected.hashes.ruleset);
    expect(result.receipt.report_hash).to.equal(expected.hashes.report);
    expect(result.coreHash).to.equal(expected.hashes.receipt_core);
  });

  it("reports the four failures and sixteen passes", () => {
    const { expected } = fixture();
    const result = buildL1();

    expect(result.receipt.summary).to.deep.equal(expected.summary);
    expect(result.receipt.verdict).to.equal("failed_checks");
    expect(result.receipt.checks.map((check: AnyJson) => check.passed)).to.deep.equal([
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it("is L1 and says the clock was injected", () => {
    const result = buildL1();

    expect(result.receipt.evidence_level).to.equal("L1");
    expect(result.receipt.anchors).to.equal(null);
    expect(result.receipt.signatures.verifier.key).to.be.a("string");
    expect(result.receipt.signatures.provider).to.equal(undefined);
    expect(result.receipt.limits.join(" ")).to.match(/injected verifier clock/);
  });

  it("keeps values out of the public receipt and in the private report", () => {
    const result = buildL1();
    const publicText = JSON.stringify(result.receipt);
    const privateText = JSON.stringify(result.report);

    expect(publicText).to.not.include("Linen Throw");
    expect(publicText).to.not.include("SKU-0002");
    expect(publicText).to.not.include("n/a");

    expect(privateText).to.include("Linen Throw");
    expect(privateText).to.include("SKU-0002");

    const types = result.receipt.checks.find((check: AnyJson) => check.id === "field_types");
    expect(types.details.price[0]).to.deep.equal({ index: 8, expected: "decimal" });
    expect(types.details.price[0].value).to.equal(undefined);
  });

  it("round-trips through the independent verifier", async () => {
    const { agreement, output } = fixture();
    const result = buildL1();

    const check = await verifyLib.verifyReceipt({
      receipt: result.receipt,
      agreement,
      output,
      report: result.report,
    });

    expect(check.steps.filter((step: AnyJson) => !step.ok)).to.deep.equal([]);
    expect(check.valid).to.equal(true);
  });

  it("detects a tampered Merkle root", async () => {
    const { agreement, output } = fixture();
    const result = buildL1();
    const tampered = JSON.parse(JSON.stringify(result.receipt));
    tampered.merkle_root = "sha256:" + "11".repeat(32);

    const check = await verifyLib.verifyReceipt({
      receipt: tampered,
      agreement,
      output,
      report: result.report,
    });

    expect(check.valid).to.equal(false);
    const failed = check.steps.filter((step: AnyJson) => !step.ok).map((step: AnyJson) => step.id);
    expect(failed).to.include("rerun");
    expect(failed).to.include("verifier_signature");
  });

  it("rejects a receipt signed by a different key", async () => {
    const { agreement, output } = fixture();
    const result = buildL1();
    const other = keys.generateKeyPair();

    const check = await verifyLib.verifyReceipt({
      receipt: result.receipt,
      agreement,
      output,
      verifierPublicKey: keys.publicKeyBase64(other.publicKey),
    });

    expect(check.valid).to.equal(false);
    expect(check.steps.find((step: AnyJson) => step.id === "verifier_signature").ok).to.equal(false);
  });

  it("rejects a receipt without limits", async () => {
    const { agreement, output } = fixture();
    const result = buildL1();
    const tampered = JSON.parse(JSON.stringify(result.receipt));
    delete tampered.limits;

    const check = await verifyLib.verifyReceipt({ receipt: tampered, agreement, output });

    expect(check.valid).to.equal(false);
    expect(check.steps.find((step: AnyJson) => step.id === "shape").ok).to.equal(false);
  });
});

/* ── merkle ──────────────────────────────────────────────────────────── */

describe("Merkle commitment", () => {
  it("verifies a proof for every record in the fixture", () => {
    const { agreement, output } = fixture();
    const parsed = canonical.parseCsv(output, agreement.deliverable.fields);
    const records = canonical.canonicalRecords(agreement, parsed);
    const run = checks.runChecks(agreement, records, FIXTURE_CLOCK);
    const ruleset = verifyLib.loadRuleset();
    const tree = merkle.buildTree(records, run.perRecord, ruleset.hash);

    records.forEach((_record: AnyJson, index: number) => {
      const proof = merkle.buildProof(tree, index);
      expect(merkle.verifyProof(canonical.hashDigest(tree.leaves[index]), proof, canonical.hashDigest(tree.root))).to.equal(true);
    });
  });

  it("binds the record into the leaf", () => {
    const { records, perRecord, ruleset, tree } = threeRecords();
    const proof = {
      record: records[1],
      checks: perRecord[1],
      ruleset,
      leaf: canonical.hashDigest(tree.leaves[1]),
      proof: merkle.buildProof(tree, 1),
      merkle_root: canonical.hashDigest(tree.root),
    };

    expect(verifyLib.verifyRecordProof(proof).ok).to.equal(true);

    const changed = JSON.parse(JSON.stringify(proof));
    changed.record.id = "z";
    const result = verifyLib.verifyRecordProof(changed);
    expect(result.leaf_matches).to.equal(false);
    expect(result.ok).to.equal(false);
  });

  it("binds the per-record result into the leaf", () => {
    const { records, perRecord, ruleset, tree } = threeRecords();
    const proof = {
      record: records[2],
      checks: perRecord[2],
      ruleset,
      proof: merkle.buildProof(tree, 2),
      merkle_root: canonical.hashDigest(tree.root),
    };

    expect(verifyLib.verifyRecordProof(proof).ok).to.equal(true);

    const flipped = JSON.parse(JSON.stringify(proof));
    flipped.checks.unique = true;
    expect(verifyLib.verifyRecordProof(flipped).ok).to.equal(false);
  });

  it("promotes an odd node instead of duplicating it", () => {
    const { records, perRecord, ruleset, tree } = threeRecords();

    // Three leaves: the third is promoted at level 1 and has no sibling there,
    // so its proof starts one level up. A duplicated-leaf tree would have two
    // steps and a different root.
    expect(tree.levels.map((level: Buffer[]) => level.length)).to.deep.equal([3, 2, 1]);
    expect(merkle.buildProof(tree, 2)).to.have.length(1);
    expect(merkle.buildProof(tree, 2)[0].side).to.equal("left");

    const four = records.concat([records[2]]);
    const duplicated = merkle.buildTree(four, perRecord.concat([perRecord[2]]), ruleset);
    expect(canonical.hashDigest(duplicated.root)).to.not.equal(canonical.hashDigest(tree.root));
  });

  it("binds the ruleset hash into the leaf", () => {
    const { records, perRecord } = threeRecords();
    const one = merkle.leafHash(records[0], perRecord[0], canonical.hashJson({ ruleset: 1 }));
    const two = merkle.leafHash(records[0], perRecord[0], canonical.hashJson({ ruleset: 2 }));

    expect(canonical.hashDigest(one)).to.not.equal(canonical.hashDigest(two));
  });
});

/* ── canonicalization ────────────────────────────────────────────────── */

describe("canonicalization", () => {
  it("normalizes decimals without floating point", () => {
    const cases: Array<[string, string]> = [
      ["034.50", "34.5"],
      ["+0.0", "0"],
      ["-0", "0"],
      ["-0.000", "0"],
      ["5.", "5"],
      ["000", "0"],
      ["-12.3400", "-12.34"],
      ["0.00012", "0.00012"],
    ];

    cases.forEach(([input, output]) => {
      expect(canonical.normalizeDecimal(input)).to.equal(output);
    });
  });

  it("rejects non-canonical decimals", () => {
    ["", " 5", "5 ", "1,000", "1e3", ".5", "NaN", "Infinity", "--1"].forEach((input) => {
      expect(canonical.tryNormalizeDecimal(input).ok).to.equal(false);
    });

    expect(canonical.tryNormalizeDecimal("1".repeat(31)).ok).to.equal(false);
  });

  it("serializes JSON with sorted keys and no whitespace", () => {
    expect(canonical.jcs({ b: 1, a: 2 })).to.equal('{"a":2,"b":1}');
    expect(canonical.jcs({ z: [1, true, null] })).to.equal('{"z":[1,true,null]}');
    expect(canonical.jcs(-0)).to.equal("0");
    expect(canonical.jcs("a\nb")).to.equal('"a\\nb"');
    // UTF-16 code unit order: "z" (0x7a) sorts before "é" (0xe9).
    expect(canonical.jcs({ é: 1, z: 2 })).to.equal('{"z":2,"é":1}');
  });

  it("refuses undefined instead of silently dropping it", () => {
    expect(() => canonical.jcs({ a: undefined })).to.throw(/undefined/);
    expect(() => canonical.jcs([undefined])).to.throw(/undefined/);
  });

  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const text = 'a,b\r\n1,"x,y"\r\n2,"say ""hi"""\r\n3,"line\nbreak"\r\n';
    const parsed = canonical.parseCsv(text, ["a", "b"]);

    expect(parsed.rows).to.deep.equal([
      { a: "1", b: "x,y" },
      { a: "2", b: 'say "hi"' },
      { a: "3", b: "line\nbreak" },
    ]);
  });

  it("maps columns by header name and ignores extra columns", () => {
    const parsed = canonical.parseCsv("b,a,notes\n2,1,x\n", ["a", "b"]);
    expect(parsed.rows[0]).to.deep.equal({ a: "1", b: "2", notes: "x" });
    expect(parsed.extraColumns).to.deep.equal(["notes"]);

    const records = canonical.canonicalRecords(
      { deliverable: { fields: ["a", "b"] }, checks: [] },
      parsed
    );
    expect(records).to.deep.equal([{ a: "1", b: "2" }]);
  });

  it("strips a BOM and ignores blank lines", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\n1\n\n2\n")]);
    const parsed = canonical.parseCsv(withBom, ["a"]);
    expect(parsed.rows).to.deep.equal([{ a: "1" }, { a: "2" }]);
  });

  it("rejects structural CSV errors", () => {
    expect(() => canonical.parseCsv("a,a\n1,2\n", ["a"])).to.throw(/duplicate header/);
    expect(() => canonical.parseCsv("a\n1\n", ["b"])).to.throw(/missing/);
    expect(() => canonical.parseCsv("a\n1,2\n", ["a"])).to.throw(/more fields/);
    expect(() => canonical.parseCsv('a\n"unterminated\n', ["a"])).to.throw(/unterminated/);
  });

  it("pads a short row and keeps whitespace in the canonical record", () => {
    const parsed = canonical.parseCsv("a,b\n1\n", ["a", "b"]);
    expect(parsed.rows[0]).to.deep.equal({ a: "1", b: "" });

    const records = canonical.canonicalRecords(
      { deliverable: { fields: ["a"] }, checks: [] },
      { rows: [{ a: "  x  " }], extraColumns: [] }
    );
    expect(records[0].a).to.equal("  x  ");
  });

  it("normalizes values to NFC", () => {
    const records = canonical.canonicalRecords(
      { deliverable: { fields: ["a"] }, checks: [] },
      { rows: [{ a: "e\u0301" }], extraColumns: [] }
    );
    expect(records[0].a).to.equal("\u00e9");
  });
});

/* ── signatures ──────────────────────────────────────────────────────── */

describe("signing", () => {
  it("separates domains so one signature cannot be replayed as another", () => {
    const payload = { hello: "world" };
    const signature = keys.sign(pair.privateKey, keys.DOMAINS.receipt, payload);
    const publicKey = keys.publicKeyBase64(pair.publicKey);

    expect(keys.verify(publicKey, keys.DOMAINS.receipt, payload, signature)).to.equal(true);
    expect(keys.verify(publicKey, keys.DOMAINS.agreement, payload, signature)).to.equal(false);
    expect(keys.verify(publicKey, keys.DOMAINS.receipt, { hello: "world!" }, signature)).to.equal(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(keys.verify(keys.publicKeyBase64(pair.publicKey), keys.DOMAINS.receipt, {}, "not-base64")).to.equal(false);
  });
});

/* ── evidence levels ─────────────────────────────────────────────────── */

describe("evidence levels", () => {
  it("issues L2 only when both parties signed and the provider attested", () => {
    const { agreement: base, output } = fixture();
    const signed = signedAgreement(base);
    const providerKey = keys.publicKeyBase64(signed.provider.publicKey);
    const signature = submissionSignature(signed.provider, signed.agreement, output, FIXTURE_CLOCK);

    const result = verifyLib.verifyOutput({
      agreement: signed.agreement,
      output,
      submittedAt: FIXTURE_CLOCK,
      createdAt: FIXTURE_CLOCK,
      evidenceLevel: "L2",
      verifierPrivateKey: pair.privateKey,
      providerPublicKey: providerKey,
      providerSignature: signature,
      injectedClock: true,
    });

    expect(result.receipt.evidence_level).to.equal("L2");
    expect(result.receipt.signatures.provider.key).to.equal(providerKey);
  });

  it("refuses L2 without a provider submission signature", () => {
    const { agreement: base, output } = fixture();
    const signed = signedAgreement(base);

    expect(() =>
      verifyLib.verifyOutput({
        agreement: signed.agreement,
        output,
        submittedAt: FIXTURE_CLOCK,
        evidenceLevel: "L2",
        verifierPrivateKey: pair.privateKey,
      })
    ).to.throw(/provider submission signature/);
  });

  it("refuses L2 when the agreement is unsigned", () => {
    const { agreement, output } = fixture();

    expect(() =>
      verifyLib.verifyOutput({
        agreement,
        output,
        submittedAt: FIXTURE_CLOCK,
        evidenceLevel: "L2",
        verifierPrivateKey: pair.privateKey,
        providerPublicKey: keys.publicKeyBase64(pair.publicKey),
        providerSignature: "AAAA",
      })
    ).to.throw(/signed agreements|signature is missing/);
  });

  it("builds L3 in two phases and enforces slot order", async () => {
    const { agreement: base, output } = fixture();
    const signed = signedAgreement(base);
    const parsed = canonical.parseCsv(output, signed.agreement.deliverable.fields);
    const records = canonical.canonicalRecords(signed.agreement, parsed);
    const agreementHash = receiptLib.agreementHash(signed.agreement);
    const outputHash = canonical.hashBytes(output);
    const blockTime = Math.floor(Date.parse(FIXTURE_CLOCK) / 1000);
    const outputBlockTime = blockTime + 60;
    const submittedAt = new Date(outputBlockTime * 1000).toISOString();

    const anchors = {
      agreement: {
        tx: "agreement-tx",
        slot: 100,
        block_time: blockTime,
        memo: anchorsLib.memoFor("agreement", agreementHash),
      },
      output: {
        tx: "output-tx",
        slot: 101,
        block_time: outputBlockTime,
        memo: anchorsLib.memoFor("output", outputHash),
      },
    };

    const signature = keys.sign(
      signed.provider.privateKey,
      keys.DOMAINS.submission,
      receiptLib.submissionPayload({
        agreementHash,
        rawOutputHash: outputHash,
        canonicalRecordsHash: canonical.hashJson(records),
        submittedAt,
      })
    );

    const result = verifyLib.verifyOutput({
      agreement: signed.agreement,
      output,
      evidenceLevel: "L3",
      createdAt: FIXTURE_CLOCK,
      verifierPrivateKey: pair.privateKey,
      providerPublicKey: keys.publicKeyBase64(signed.provider.publicKey),
      providerSignature: signature,
      anchors,
    });

    expect(result.receipt.evidence_level).to.equal("L3");
    expect(result.receipt.submitted_at).to.equal(submittedAt);
    expect(result.receipt.anchors.receipt).to.equal(null);
    expect(result.pending.memo).to.equal(anchorsLib.memoFor("receipt", result.coreHash));

    const final = verifyLib.attachAnchors(result.receipt, {
      agreement: anchors.agreement,
      output: anchors.output,
      receipt: {
        tx: "receipt-tx",
        slot: 102,
        block_time: outputBlockTime + 60,
        memo: result.pending.memo,
      },
    });

    const verified = await verifyLib.verifyReceipt({
      receipt: final,
      agreement: signed.agreement,
      output,
    });
    expect(verified.valid).to.equal(true);

    expect(() =>
      verifyLib.attachAnchors(result.receipt, {
        agreement: anchors.agreement,
        output: anchors.output,
        receipt: {
          tx: "early-receipt",
          slot: 100,
          block_time: outputBlockTime,
          memo: result.pending.memo,
        },
      })
    ).to.throw(/not before/);
  });

  it("refuses L3 when the anchors share a slot", () => {
    const { agreement: base, output } = fixture();
    const signed = signedAgreement(base);
    const agreementHash = receiptLib.agreementHash(signed.agreement);
    const outputHash = canonical.hashBytes(output);

    expect(() =>
      verifyLib.verifyOutput({
        agreement: signed.agreement,
        output,
        evidenceLevel: "L3",
        verifierPrivateKey: pair.privateKey,
        anchors: {
          agreement: {
            tx: "a",
            slot: 7,
            block_time: Math.floor(Date.parse(FIXTURE_CLOCK) / 1000),
            memo: anchorsLib.memoFor("agreement", agreementHash),
          },
          output: {
            tx: "b",
            slot: 7,
            block_time: Math.floor(Date.parse(FIXTURE_CLOCK) / 1000),
            memo: anchorsLib.memoFor("output", outputHash),
          },
        },
      })
    ).to.throw(/not before/);
  });

  it("refuses an L3 receipt whose clock is not the output anchor block time", async () => {
    const { agreement: base, output } = fixture();
    const signed = signedAgreement(base);
    const outputHash = canonical.hashBytes(output);
    const parsed = canonical.parseCsv(output, signed.agreement.deliverable.fields);
    const records = canonical.canonicalRecords(signed.agreement, parsed);
    const agreementHash = receiptLib.agreementHash(signed.agreement);
    const blockTime = Math.floor(Date.parse(FIXTURE_CLOCK) / 1000);
    const outputBlockTime = blockTime + 60;
    const submittedAt = new Date(outputBlockTime * 1000).toISOString();

    const anchors = {
      agreement: {
        tx: "agreement-tx",
        slot: 100,
        block_time: blockTime,
        memo: anchorsLib.memoFor("agreement", agreementHash),
      },
      output: {
        tx: "output-tx",
        slot: 101,
        block_time: outputBlockTime,
        memo: anchorsLib.memoFor("output", outputHash),
      },
    };

    const signature = keys.sign(
      signed.provider.privateKey,
      keys.DOMAINS.submission,
      receiptLib.submissionPayload({
        agreementHash,
        rawOutputHash: outputHash,
        canonicalRecordsHash: canonical.hashJson(records),
        submittedAt,
      })
    );

    const result = verifyLib.verifyOutput({
      agreement: signed.agreement,
      output,
      evidenceLevel: "L3",
      createdAt: FIXTURE_CLOCK,
      verifierPrivateKey: pair.privateKey,
      providerPublicKey: keys.publicKeyBase64(signed.provider.publicKey),
      providerSignature: signature,
      anchors,
    });

    const shifted = Object.assign({}, result.receipt, { submitted_at: FIXTURE_CLOCK });
    const shiftedHash = receiptLib.coreHash(shifted);

    expect(() =>
      verifyLib.attachAnchors(shifted, {
        agreement: anchors.agreement,
        output: anchors.output,
        receipt: {
          tx: "shifted-receipt",
          slot: 102,
          block_time: outputBlockTime + 60,
          memo: anchorsLib.memoFor("receipt", shiftedHash),
        },
      })
    ).to.throw(/does not match the output anchor block time/);

    /* Even when both signers collude and re-anchor the backdated core, the
     * independent verifier must reject the clock. */
    shifted.signatures = Object.assign({}, shifted.signatures);
    shifted.signatures.provider = Object.assign({}, shifted.signatures.provider, {
      sig: keys.sign(
        signed.provider.privateKey,
        keys.DOMAINS.submission,
        receiptLib.submissionPayload({
          agreementHash,
          rawOutputHash: outputHash,
          canonicalRecordsHash: canonical.hashJson(records),
          submittedAt: FIXTURE_CLOCK,
        })
      ),
    });
    shifted.signatures.verifier = Object.assign({}, shifted.signatures.verifier, {
      sig: keys.sign(pair.privateKey, keys.DOMAINS.receipt, shiftedHash),
    });
    shifted.anchors = Object.assign({}, shifted.anchors, {
      receipt: {
        tx: "forged-receipt",
        slot: 102,
        block_time: outputBlockTime + 60,
        memo: anchorsLib.memoFor("receipt", shiftedHash),
      },
    });

    const check = await verifyLib.verifyReceipt({
      receipt: shifted,
      agreement: signed.agreement,
      output,
    });

    const clockStep = check.steps.find((step: AnyJson) => step.id === "submitted_at_clock");
    expect(clockStep.ok).to.equal(false);
    expect(check.valid).to.equal(false);
  });
});

/* ── anchors ─────────────────────────────────────────────────────────── */

describe("anchors", () => {
  const hash = canonical.hashJson({ demo: true });

  it("round-trips the memo format", () => {
    expect(anchorsLib.memoFor("receipt", hash)).to.equal("equxi:aas2:v0.1:receipt:" + hash);
    expect(anchorsLib.parseMemo(anchorsLib.memoFor("receipt", hash))).to.deep.equal({
      kind: "receipt",
      hash,
    });
    expect(anchorsLib.parseMemo("equxi:aas2:v0.1:receipt:not-a-hash")).to.equal(null);
    expect(anchorsLib.parseMemo("unrelated")).to.equal(null);
  });

  it("refuses an unordered anchor set", () => {
    const check = anchorsLib.validateAnchorSet(
      {
        agreement: { tx: "a", slot: 2, memo: anchorsLib.memoFor("agreement", hash) },
        output: { tx: "b", slot: 2, memo: anchorsLib.memoFor("output", hash) },
        receipt: { tx: "c", slot: 3, memo: anchorsLib.memoFor("receipt", hash) },
      },
      { agreement: hash, output: hash, receipt: hash }
    );

    expect(check.ok).to.equal(false);
    expect(check.errors.join(" ")).to.match(/not before/);
  });

  it("reads a memo transaction over JSON-RPC", async () => {
    const memo = anchorsLib.memoFor("output", hash);
    let requested: AnyJson = null;

    const fetchStub = async (_url: string, init: AnyJson) => {
      requested = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            slot: 555,
            blockTime: 1_763_200_000,
            transaction: {
              message: {
                accountKeys: [anchorsLib.MEMO_PROGRAM_ID, "provider"],
                instructions: [
                  { programIdIndex: 1, data: "" },
                  { programIdIndex: 0, data: Buffer.from(memo, "utf8").toString("base64") },
                ],
              },
            },
          },
        }),
      };
    };

    const read = await anchorsLib.readAnchor("https://rpc.example", "sig", fetchStub);

    expect(requested.method).to.equal("getTransaction");
    expect(read.kind).to.equal("output");
    expect(read.hash).to.equal(hash);
    expect(read.anchor.slot).to.equal(555);
    expect(read.anchor.memo).to.equal(memo);
  });
});

/* ── API ─────────────────────────────────────────────────────────────── */

describe("POST /api/verify", () => {
  const original = process.env.EQUXI_AAS2_VERIFIER_KEY;

  function makeRes() {
    const headers: Record<string, string> = {};
    let body = "";
    return {
      res: {
        statusCode: 0,
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
        end(chunk?: string) {
          body = chunk || "";
        },
      },
      headers,
      bodyText: () => body,
    };
  }

  function configureKey() {
    const generated = keys.generateKeyPair();
    const pem = generated.privateKey.export({ type: "pkcs8", format: "pem" });
    process.env.EQUXI_AAS2_VERIFIER_KEY = Buffer.from(pem, "utf8").toString("base64");
    return generated;
  }

  afterEach(() => {
    if (original === undefined) delete process.env.EQUXI_AAS2_VERIFIER_KEY;
    else process.env.EQUXI_AAS2_VERIFIER_KEY = original;
  });

  it("answers 503 rather than issuing an unsigned receipt", async () => {
    delete process.env.EQUXI_AAS2_VERIFIER_KEY;
    const { agreement, output } = fixture();
    const { res, bodyText } = makeRes();

    await verifyHandler(
      {
        method: "POST",
        headers: {},
        body: { agreement, output: output.toString("utf8"), submitted_at: FIXTURE_CLOCK },
      },
      res
    );

    expect(res.statusCode).to.equal(503);
    expect(JSON.parse(bodyText()).error).to.equal("verifier_key_not_configured");
  });

  it("returns a signed L1 receipt with the fixture core hash", async () => {
    configureKey();
    const { agreement, output, expected } = fixture();
    const { res, bodyText } = makeRes();

    await verifyHandler(
      {
        method: "POST",
        headers: {},
        body: {
          agreement,
          output: output.toString("utf8"),
          submitted_at: FIXTURE_CLOCK,
          created_at: FIXTURE_CLOCK,
        },
      },
      res
    );

    const payload = JSON.parse(bodyText());
    expect(res.statusCode).to.equal(200);
    expect(payload.ok).to.equal(true);
    expect(payload.core_hash).to.equal(expected.hashes.receipt_core);
    expect(payload.receipt.verdict).to.equal("failed_checks");
    expect(payload.receipt.summary.failed_records).to.deep.equal([3, 8, 10, 16]);
    expect(payload.report.records).to.have.length(20);
  });

  it("answers 405 for GET and 400 for L3", async () => {
    configureKey();

    const get = makeRes();
    await verifyHandler({ method: "GET", headers: {} }, get.res);
    expect(get.res.statusCode).to.equal(405);

    const l3 = makeRes();
    await verifyHandler(
      { method: "POST", headers: {}, body: { evidence_level: "L3" } },
      l3.res
    );
    expect(l3.res.statusCode).to.equal(400);
    expect(JSON.parse(l3.bodyText()).error).to.equal("l3_not_available_over_api");
  });

  it("rejects a malformed body without throwing", async () => {
    configureKey();
    const { res, bodyText } = makeRes();

    await verifyHandler({ method: "POST", headers: {}, body: "not json" }, res);

    expect(res.statusCode).to.equal(400);
    expect(JSON.parse(bodyText()).error).to.equal("invalid_body");
  });
});
