# Proof of Delivery Standard (AAS-2)

**Status:** Draft
**Version:** `aas-2/0.1`
**Extends:** [AAS-1](SPEC.md) (bonds, violations, compensation)
**Scope:** agreements, deterministic delivery checks, signed receipts, and on-chain anchors for AI-produced artifacts
**Reference implementation:** Equxi (`D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`)
**Normative language:** MUST, MUST NOT, SHOULD, and MAY as defined in RFC 2119.

---

## 1. Why this exists

AAS-1 defines economic consequence. It does not define evidence.

AAS-1 §7.1 states the problem directly: detection is off-chain, and a slash is asserted, not proven. AAS-1 §7.2 adds that a slash is final. AAS-2 supplies the missing artifact: a delivery receipt that binds a pre-committed agreement, a provider-signed output, a deterministic check run, and a verifier signature to an ordered set of on-chain anchors.

AAS-2 is artifact-centric on purpose. It verifies what was delivered, not who the agent claims to be. Agent identity, model provenance, and framework integration are out of scope. Any of them can produce the artifact.

The unit of accountability is not the agent. It is the **delivery**.

## 2. Terms

| Term | Definition |
|---|---|
| **Agreement** | A JSON document that fixes the parties, the deliverable, the acceptance checks, the deadline, the remedy, and the dispute window before work begins. |
| **Deliverable** | The artifact the provider owes. In v0.1, a record set parsed from CSV. |
| **Record** | One logical row in the deliverable, canonicalized as a JSON object. |
| **Ruleset** | A versioned, published set of check semantics. Its hash is committed in every receipt. |
| **Check** | A deterministic test over canonical records. A check returns a per-record boolean and a failure report. |
| **Output** | The submitted artifact, as raw bytes. |
| **Submission** | The provider-signed binding of an agreement hash, an output hash, and a timestamp. |
| **Receipt** | The verifier-signed record of the checks, hashes, verdict, anchors, and limits. |
| **Anchor** | A Solana transaction whose memo commits to one hash in the lifecycle. |
| **Evidence level** | L1 observed, L2 attested, L3 anchored. Defined in §9. |
| **Verifier** | The party that runs the ruleset and signs the receipt. |
| **Private report** | The detailed record-level report, including values, delivered to the parties and hash-committed in the receipt. |
| **Public receipt** | The hash-only artifact suitable for publication. |
| **Remedy** | The consequence the agreement assigns to a failed check. AAS-2 does not enforce it. |

## 3. Invariants

**P1.** Both parties MUST sign the agreement before the output is submitted, for L2 and L3. For L3, the agreement hash MUST be anchored before submission.

**P2.** The provider MUST sign the submission, binding the agreement hash, the raw output hash, the canonical records hash, and the submission timestamp, before verification begins.

**P3.** The verifier MUST sign the receipt, binding the checks, the ruleset hash, the hashes, the verdict, and the anchors.

**P4.** Hashes MUST be computed over canonical forms. The raw output hash is computed separately and included for provenance.

**P5.** Every receipt MUST include the ruleset identifier, version, and content hash.

**P6.** The checks MUST be deterministic and public. The same ruleset and the same canonical records MUST produce the same per-record results in any conforming implementation.

**P7.** Each Merkle leaf MUST commit to the record, its per-record check results, and the ruleset hash. A root over records alone is not conformant.

**P8.** Every receipt MUST declare its evidence level. A receipt MUST NOT claim a higher level than its signatures and anchors support.

**P9.** Every receipt MUST contain a machine-readable and human-readable `limits` section. A receipt without limits is invalid.

**P10.** No record values, personal data, or raw output may be written on-chain. Only hashes, counts, identifiers, and verdicts may be anchored.

**P11.** A failed check MUST NOT automatically trigger a slash, a payment, or a breach declaration. Remedy is a separate, reviewed decision.

**P12.** The verifier MUST NOT sign a receipt for an output hash it did not verify.

**P13.** A receipt MUST be verifiable using only public data: the public key, the ruleset, this specification, the agreement, the output, and the anchors.

**P14.** A receipt MUST be content-addressed. The `receipt_core_hash` identifies the verified content; two receipts with the same core hash MUST have identical core fields. Anchors and signatures are outside the core.

**P15.** Deadline evaluation MUST use the provider-signed submission timestamp for L2 and the output anchor block time for L3. A receipt that uses an injected or local clock MUST be L1 and MUST say so in `limits`.

**P16.** Numeric values MUST be canonical decimal strings. No floating-point arithmetic may affect a hash or a check result.

**P17.** An anchored agreement is immutable. Any change creates a new agreement hash and a new receipt chain.

**P18.** A verifier MUST NOT issue two different receipts for the same output hash under the same agreement. If it does, the anchors expose the equivocation.

**P19.** The private report MUST be hash-committed in the receipt as `report_hash`, so parties can prove the report they hold is the one the verifier issued without publishing values.

**P20.** A conforming implementation MUST pass the reference fixtures for its declared ruleset version.

## 4. Agreement model

An agreement is JSON, canonicalized with RFC 8785, signed by both parties, and anchored by hash. The agreement itself stays off-chain.

```json
{
  "v": "aas-2/0.1",
  "id": "agr_demo_product_feed_0001",
  "ruleset": "equxi/checks@0.1.0",
  "customer": {"id": "did:demo:customer", "name": "Demo Customer"},
  "provider": {"id": "did:demo:provider", "name": "Demo Provider"},
  "deliverable": {
    "kind": "records",
    "format": "csv",
    "expected_count": 20,
    "fields": ["sku", "name", "category", "price", "currency"]
  },
  "checks": [
    {"id": "record_count", "expected": 20},
    {"id": "required_fields", "fields": ["sku", "name", "category", "price", "currency"]},
    {"id": "field_types", "schema": {
      "sku": "string", "name": "string", "category": "string",
      "price": "decimal", "currency": "string"
    }},
    {"id": "unique", "field": "sku"},
    {"id": "deadline", "at": "2026-12-01T00:00:00Z", "tolerance_seconds": 0}
  ],
  "remedy": {"kind": "refund_percent", "percent": 10},
  "dispute": {"review_hours": 48},
  "privacy": {"public_receipt": "hashes_only", "report": "parties_only"},
  "created_at": "2026-11-01T00:00:00Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `v` | yes | `aas-2/0.1` |
| `id` | yes | Unique per agreement. Opaque string. |
| `ruleset` | yes | Must match the receipt. |
| `customer.id` | yes | DID or public key. |
| `provider.id` | yes | DID or public key. |
| `provider.agent` | no | AAS-1 agent PDA, when the provider is an agent. |
| `deliverable.kind` | yes | `records` in v0.1. |
| `deliverable.format` | yes | `csv` in v0.1. |
| `deliverable.expected_count` | yes | Integer greater than or equal to 1. |
| `deliverable.fields` | yes | Declared columns. |
| `checks` | yes | One or more of the five v0.1 checks. |
| `remedy` | no | Descriptive. AAS-2 does not enforce it. |
| `dispute.review_hours` | no | Default 48. |
| `privacy` | no | Defaults in §13. |
| `created_at` | yes | RFC 3339 UTC. |
| `signatures` | for L2 and above | Customer and provider signatures, defined in §8.1. |

Lifecycle:

```text
draft -> signed -> anchored (L3) -> submitted -> verified -> passed
                                                        |
                                                        +-> failed_checks -> review -> closed
```

`failed_checks` is not a breach. It is a fact. The review step is where a remedy decision is made, if any.

## 5. Checks

v0.1 defines exactly five checks. A ruleset version may add checks. It may not change the semantics of these five without a new version.

### 5.1 `record_count`

- Input: `expected`, an integer greater than or equal to 1.
- Pass: the number of parsed records equals `expected`.
- Failure report: `expected`, `actual`, `delta`.
- Blank lines are ignored. The header is not a record.

### 5.2 `required_fields`

- Input: `fields`, an array of top-level field names.
- A record passes iff every field exists, is not `null`, and is not an empty string after Unicode NFC normalization and trimming.
- `0`, `false`, and empty arrays are present values.
- Failure report: per field, the list of failing record indices.

### 5.3 `field_types`

- Input: `schema`, a map of field name to one of `string`, `integer`, `decimal`, `boolean`, `date`.
- Missing or `null` values fail every type.
- `string`: any UTF-8 string after NFC normalization.
- `integer`: a canonical decimal with no fractional part.
- `decimal`: a canonical decimal per §6.3.
- `boolean`: `true` or `false`, case-insensitive, normalized to lowercase.
- `date`: `YYYY-MM-DD`, a valid Gregorian date.
- Failure report (private report): per field, the list of `{index, value, expected}` entries. The public receipt MUST omit `value`.

### 5.4 `unique`

- Input: `field`, a top-level field name.
- Compare the canonical value of the field. Missing and `null` values are not compared.
- The first occurrence passes. Every later occurrence fails.
- Failure report (private report): per duplicate value, the indices and the extra indices. The public receipt MUST omit the value.

### 5.5 `deadline`

- Input: `at` (RFC 3339 UTC) and optional `tolerance_seconds` (0 to 300, default 0).
- Pass: `submitted_at <= at + tolerance_seconds`.
- L1: `submitted_at` is the verifier clock. The receipt MUST say so in `limits`.
- L2: `submitted_at` is the provider-signed submission timestamp. The receipt MUST say it is provider-asserted, not chain-verified.
- L3: `submitted_at` is the output anchor block time. The receipt MUST carry that time in `submitted_at` and MUST NOT use any other clock.
- At L3, the output anchor is confirmed first. The provider then signs the submission with the anchor's `block_time`, and verification runs after that. A verifier that signs before the output anchor exists cannot produce a conformant L3 receipt.
- For L1 fixtures only, an injected clock MAY be used. The receipt MUST say so in `limits`.
- Check detail: `at`, `submitted_at`, `tolerance_seconds`, `late_seconds`. The detail is reported whether the check passes or fails, and contains no record values.

A check that cannot parse its input is an error, not a failed check. An error produces no signed receipt.

## 6. Canonicalization

Canonicalization is what makes a receipt reproducible. An implementation that skips it produces hashes nobody else can reproduce.

### 6.1 JSON

- RFC 8785 JSON Canonicalization Scheme.
- UTF-8, no BOM, no insignificant whitespace, keys sorted.
- Structural numbers are integers or JSON numbers serialized per JCS.
- Business values that must be exact are stored as canonical decimal strings, not JSON numbers.

### 6.2 CSV

- RFC 4180 parsing.
- UTF-8. A leading BOM is stripped.
- The first row is a header. Duplicate header names are invalid.
- Columns are mapped by header name, not position.
- A record with fewer cells than the header is padded with empty strings.
- A record with more cells than the header is an error.
- Only declared fields enter the canonical record. Extra columns are ignored for checks, counted in the report, and never hashed, so adding an undeclared column does not change `canonical_records_hash`.
- A missing declared column is an error.
- Blank lines are ignored.

### 6.3 Decimal normalization

A decimal is normalized to a canonical string:

1. Optional leading `-` or `+`. A `+` is removed.
2. Digits before an optional `.` and digits after it.
3. No exponent, no thousands separators, no whitespace.
4. Leading zeros are removed from the integer part. `0` is kept for zero.
5. Trailing zeros are removed from the fraction. A trailing `.` is removed.
6. Zero is `0`, never `-0`.
7. At most 30 significant digits. Significant digits are the digits of the integer and fraction after leading zeros are removed; the sign and the decimal point do not count. More is a normalization failure.
8. `NaN`, `Infinity`, and empty strings are errors.

Examples: `034.50` becomes `34.5`; `+0.0` becomes `0`; `-0` becomes `0`; `1,000` is an error.

A business value that cannot be normalized is not an AAS-2 error. The canonical record carries its Unicode NFC text unchanged, and `field_types` fails that record for the field (§5.3). Normalization failure is an error only where the spec requires a canonical decimal, such as a structural hash input. This distinction keeps the delivery verifiable: an output containing `n/a` in a `decimal` column is a failed check with a provable record, not a delivery nobody can verify.

### 6.4 Record canonical form

- An object with sorted keys.
- Strings are Unicode NFC. They are not trimmed. Trimming is a check semantic only.
- Decimals are canonical decimal strings.
- Booleans are lowercase strings.
- Dates are `YYYY-MM-DD`.
- Missing fields are omitted, not set to `null`.

### 6.5 Hashes

- `raw_output_hash = SHA-256(exact uploaded bytes)`.
- `canonical_records_hash = SHA-256(canonical_json(array of canonical records))`.
- `agreement_hash = SHA-256(canonical_json(agreement without signatures))`.
- `ruleset_hash = SHA-256(canonical_json(ruleset document))`.
- Hashes are written with a `sha256:` prefix.

## 7. Merkle commitment

The Merkle tree commits to per-record results, not just records. This is what makes a failed record provable without publishing the dataset.

For record `i`:

```text
leaf_i = SHA-256(0x00 || canonical_json({
  "record": record_i,
  "checks": {check_id: true | false, ...},
  "ruleset": ruleset_hash
}))
```

`checks` contains only the record-scope checks of the agreement: `required_fields`, `field_types`, and `unique` in v0.1. `record_count` and `deadline` are deliverable-scope checks and have no per-record result. They are covered by the signed receipt core, and the ruleset document MUST declare each check's `scope`. A leaf that omits a per-record result, or includes a deliverable-scope result, is non-conformant.

Internal node:

```text
node = SHA-256(0x01 || left || right)
```

- Leaves are ordered by input record order.
- If a level has an odd number of nodes, the last node is promoted unchanged, RFC 6962 style, not duplicated.
- An empty record set is invalid. `record_count` requires at least one record.
- A proof is an array of `{side: "left" | "right", hash: "sha256:..."}`.
- The root is `merkle_root` in the receipt.
- `canonical_records_hash` is separate and exists so a verifier can check the whole set without rebuilding the tree.

## 8. Receipt

The receipt is public. It contains hashes, counts, indices, and verdicts, never values.

```json
{
  "v": "aas-2/0.1",
  "agreement": "sha256:...",
  "raw_output": "sha256:...",
  "canonical_records": "sha256:...",
  "merkle_root": "sha256:...",
  "ruleset": {
    "id": "equxi/checks",
    "version": "0.1.0",
    "hash": "sha256:...",
    "url": "https://www.equxi.tech/aas-2/rulesets/equxi-checks-0.1.0.json"
  },
  "evidence_level": "L3",
  "submitted_at": "2026-11-15T10:00:00Z",
  "summary": {
    "expected": 20,
    "received": 20,
    "passed_records": 16,
    "failed_records": [3, 8, 10, 16],
    "failed_record_count": 4
  },
  "checks": [
    {"id": "record_count", "passed": true, "failed_count": 0},
    {"id": "required_fields", "passed": false, "failed_count": 2,
     "details": {"category": [3, 10]}},
    {"id": "field_types", "passed": false, "failed_count": 1,
     "details": {"price": [{"index": 8, "expected": "decimal"}]}},
    {"id": "unique", "passed": false, "failed_count": 1,
     "details": {"sku": [{"indices": [1, 16], "extra": [16]}]}},
    {"id": "deadline", "passed": true, "failed_count": 0,
     "details": {"at": "2026-12-01T00:00:00Z", "submitted_at": "2026-11-15T10:00:00Z",
                 "tolerance_seconds": 0, "late_seconds": 0}}
  ],
  "verdict": "failed_checks",
  "report_hash": "sha256:...",
  "anchors": {
    "agreement": {"tx": "...", "slot": 0, "block_time": 0},
    "output": {"tx": "...", "slot": 0, "block_time": 0},
    "receipt": {"tx": "...", "slot": 0, "block_time": 0}
  },
  "signatures": {
    "provider": {"key": "...", "sig": "..."},
    "verifier": {"key": "...", "sig": "..."}
  },
  "limits": [
    "Checks are limited to the published ruleset; they do not prove factual accuracy.",
    "The receipt binds the submitted output hash; it does not prove which model or process produced it.",
    "A failed check is a verification result, not a legal breach."
  ],
  "created_at": "2026-11-01T00:00:00Z"
}
```

Rules:

- `verdict` is `passed`, `failed_checks`, or `error`. An `error` receipt is not signed.
- `submitted_at` is the deadline clock the checks used, restated at the top of the receipt. It is the clock defined for the evidence level in §5.5. A verifier MUST reject an L3 receipt whose `submitted_at` differs from its output anchor block time.
- `summary.failed_records` is the sorted union of indices that fail at least one check.
- `checks[].details` contains indices, never values. The check-level report MAY include values for the private report; the public receipt MUST strip them.
- The `deadline` detail (`at`, `submitted_at`, `tolerance_seconds`, `late_seconds`) is always reported, pass or fail. It carries timestamps, not record values.
- `report_hash` commits to the private report. The report is canonical JSON and includes values and per-check details.
- `receipt_core_hash` is `SHA-256(canonical_json(receipt without "anchors" and "signatures"))`. It is the identifier and the signing payload.
- The full receipt, after anchors and signatures are added, is what gets served. It does not need a second hash.

### 8.1 Signing payloads

Signatures are Ed25519 over:

```text
SHA-256(domain || 0x00 || canonical_json(payload))
```

| Artifact | Domain | Payload |
|---|---|---|
| Agreement | `equxi/aas-2/agreement/v0.1` | agreement without `signatures` |
| Submission | `equxi/aas-2/submission/v0.1` | `agreement`, `raw_output`, `canonical_records`, `submitted_at` |
| Receipt | `equxi/aas-2/receipt/v0.1` | `receipt_core_hash` |
| Report | `equxi/aas-2/report/v0.1` | `report_hash` |

A signature MUST NOT cover itself. The receipt signature covers the core hash, not the receipt with signatures.

## 9. Anchors and evidence levels

Three anchors, in order:

| Step | Memo content | Signed by | Requirement |
|---|---|---|---|
| Agreement | `equxi:aas2:v0.1:agreement:<hash>` | customer and provider | Before submission for L3. Recommended for L2 |
| Output | `equxi:aas2:v0.1:output:<hash>` | provider | At submission, before verification, for L3 |
| Receipt | `equxi:aas2:v0.1:receipt:<hash>` | verifier | After verification, for L3 |

Ordering:

- `agreement.slot < output.slot < receipt.slot` for L3.
- Equal slots do not establish order. An implementation that cannot prove order MUST NOT claim L3.
- `block_time` is the deadline clock for L2 and L3.
- At L3, `submitted_at` is the output anchor `block_time`. The output anchor is confirmed first, the provider signs the submission with that time, and verification runs after. A verifier MUST reject an L3 receipt whose `submitted_at` differs from the output anchor block time.

Evidence levels:

| Level | Name | Requires | What it means |
|---|---|---|---|
| L1 | Observed | Verifier signature | The verifier ran the checks on this output. No provider attestation, no ordering. |
| L2 | Attested | Verifier and provider signatures | The provider signed this output hash against this agreement. The timestamp is provider-asserted, not chain-verified. |
| L3 | Anchored | L2 plus all three anchors in order | The agreement existed before the output, and the verdict existed after it. |

A receipt with an invalid signature or an invalid anchor is invalid, not downgraded. The verifier MUST NOT publish it as a lower level.

## 10. Verification algorithm

A third party verifies a receipt as follows:

1. Fetch the receipt, the agreement, the output, the ruleset, and the verifier's public key.
2. Recompute `agreement_hash` from the agreement without signatures. Compare with the receipt and the agreement anchor.
3. Recompute `raw_output_hash` and `canonical_records_hash` from the output. Compare with the receipt.
4. Recompute the canonical records and rerun the ruleset. Compare per-check results, failed indices, and `merkle_root`.
5. Recompute the private report hash if the report is available. Compare with `report_hash`.
6. Verify the verifier signature over `receipt_core_hash`.
7. Verify the provider signature over the submission payload, for L2 and L3.
8. Verify all three anchors for L3, including memo content and slot order, and verify `submitted_at` equals the output anchor block time.
9. Verify the declared `evidence_level` matches the signatures and anchors.
10. Verify `limits` is present and non-empty.

A verification result is a list of pass or fail steps, not a single boolean. A receipt is valid only if every applicable step passes.

## 11. Trust and threat model

| Attack | Detection | Residual risk |
|---|---|---|
| Provider swaps the output after verification | Raw and canonical hashes no longer match | None if the customer holds the original |
| Customer changes acceptance criteria after seeing the output | Agreement hash does not match the pre-commitment anchor | None for L3 |
| Provider disowns the output | Submission signature and output anchor do not match | None for L2 and L3 |
| Verifier lies about a check result | Anyone reruns the public ruleset on the canonical records | The verifier can refuse to issue receipts, but cannot forge a passing one |
| Verifier equivocates with two receipts for one output | Two receipt anchors for the same output hash | Visible, not preventable |
| Provider and verifier collude on a false passing receipt | The customer reruns the checks if they hold the output | If the customer never receives the output, no receipt helps. Delivery of the artifact is a precondition |
| Admin slashes without a valid receipt | The slash reason should reference a receipt hash. A missing or invalid reference is visible | AAS-1 slashing remains admin-gated |
| Replay of an old receipt | Agreement id, output hash, and anchors must all match | None |
| Clock manipulation for the deadline | L3 uses the output anchor block time. L2 uses a provider-signed time and says so. L1 is labelled | L1 and L2 deadlines depend on the signer's clock |
| Data leak through the public receipt | Only hashes, indices, and counts are public | Indices can leak structure. Use hashes-only mode for sensitive sets |

The receipt proves **what the verifier checked and when**, not that the checks were sufficient for the business. That is a decision the parties make in the agreement.

## 12. Remedy and dispute

AAS-2 does not move money. It produces evidence.

- A failed check is a fact. It is not a breach, a fraud finding, or a payment instruction.
- The agreement MAY name a remedy, but the remedy is executed by the parties or by AAS-1 settlement, after review.
- The bond in AAS-1 is per agent, not per agreement. It does not track which agreement it secures, and it cannot cover several agreements at once without overcommitment. A receipt MUST NOT claim that a bond covers an agreement unless the agreement names the bond and the coverage amount. Even then the claim is a statement of intent, not enforcement.
- Automatic slashing is out of scope for v0.1. A conforming implementation MUST NOT wire a failed check directly to `execute_slash`.
- The review window is defined in the agreement (`dispute.review_hours`). During the window, the provider may resubmit a corrected output as a new submission and a new receipt.
- Arbitration is out of scope. AAS-2 gives an arbitrator evidence. It does not appoint one.

## 13. Privacy

- Public receipt: hashes, counts, indices, verdict, limits.
- Private report: values, per-record details, and the full failure list. It is canonicalized, hashed, and delivered to the parties.
- No record values, PII, or raw output on-chain.
- Selective disclosure: a party can prove record `i` failed by revealing `record_i`, its leaf, and the Merkle proof. It does not need to reveal the other records.
- Encryption of the private report is allowed but not specified in v0.1. If used, the receipt commits to the ciphertext hash.

## 14. Versioning and conformance

- Receipt version: `aas-2/0.1`.
- Ruleset id and version are independent of the receipt version.
- Changing a check's semantics requires a new ruleset version. Old receipts remain valid under the version they name.
- Hash algorithm is `sha256` in v0.1. A future version may add algorithms with a prefix.
- Canonicalization is `jcs-rfc8785` for JSON and `csv-rfc4180` for input parsing, plus §6.3 for decimals.
- A conforming implementation MUST pass the fixtures in `fixtures/aas-2/` for its declared ruleset version.

## 15. Known open problems

AAS-2 (draft) does not yet specify:

1. **Factual accuracy.** Checks are structural. A passing receipt does not mean the content is true.
2. **Per-agreement coverage.** AAS-1 bonds are per agent. Reserving collateral per agreement needs a new account or a coverage field.
3. **Arbitration.** Evidence is not a decision. A challenge and appeal process is out of scope.
4. **Verifier decentralization.** v0.1 assumes one verifier key. A staked verifier set or an optimistic challenge is future work.
5. **Privacy-preserving checks.** Merkle proofs reveal the failing record. Proving a check passed without revealing the data needs zero-knowledge proofs.
6. **Ruleset registry.** A public registry of versioned rulesets and hashes would make third-party verification easier.
7. **Legal enforceability.** A signed receipt is evidence, not a judgment. Jurisdiction and liability are agreement-level concerns.
8. **Large datasets.** v0.1 loads the record set in memory. Streaming Merkle trees are future work.
9. **Cross-chain anchors.** v0.1 anchors on Solana. Verifying an anchor on another chain is out of scope.
10. **Timestamp trust below L3.** L1 depends on the verifier's clock. L2 depends on the provider's clock. L3 uses the chain.

## 16. Reference implementation notes

Equxi implements AAS-2 with the following deliberate boundaries:

- **Stateless verification.** `POST /api/verify` takes an agreement, an output, and optional signatures. It returns a receipt and a private report. No database is required for v0.1.
- **No program change.** Anchors use SPL Memo transactions. The AAS-1 program is unchanged, so there is no account-layout migration.
- **One verifier key.** A deployment publishes its verifier key at `/.well-known/equxi-verifier.json`. That document lists the active `key_id`, algorithm, validity, rulesets, and rotation policy; receipts carry the raw public key inline, so the file maps a receipt to a published identity. `POST /api/verify` answers 503 rather than issuing an unsigned receipt when `EQUXI_AAS2_VERIFIER_KEY` is unset. In production the key SHOULD be distinct from the AAS-1 admin key, so a compromised receipt signer cannot slash. That is a trusted-verifier model, not a trustless one.
- **Open ruleset.** The check implementations and the ruleset document are published. The receipt commits to the ruleset hash.
- **CLI first.** `node aas2.js verify --agreement ... --output ...` is the reference path. The API wraps the same code. `verify-receipt` re-checks a receipt independently, and `prove --index i` produces the selective-disclosure proof for record `i`.
- **Anchors are writable.** `node aas2.js anchor --kind ... --keypair ... --rpc ...` submits the SPL Memo transaction and reads it back before reporting success. `sign-agreement` and `sign-submission` produce the signatures L2 and L3 require.
- **Fixtures first.** `fixtures/aas-2/` pins the check semantics and content hashes at L1. `fixtures/aas-2/l2/` pins an L2 receipt with customer and provider signatures. `fixtures/aas-2/devnet/` and `fixtures/aas-2/mainnet/` pin live three-anchor L3 runs with their transactions, slots, and receipts so the on-chain path is reproducible on both clusters. `tests/unit/aas2.test.ts` runs the fixtures and every pinned hash against the implementation.

The reference implementation does not claim that AAS-2 is trustless, that a receipt proves factual accuracy, or that a failed check is a breach.

## 17. Conformance checklist

- [ ] Agreement is canonicalized, signed by both parties, and anchored before submission for L2 and L3
- [ ] Submission is provider-signed and binds the agreement hash, raw output hash, canonical records hash, and timestamp
- [ ] Checks are public, versioned, and deterministic
- [ ] Canonicalization follows §6, including decimal normalization
- [ ] Merkle leaves commit to record, per-record results, and ruleset hash, and omit deliverable-scope checks
- [ ] Receipt contains the ruleset hash, report hash, evidence level, submitted_at, and limits
- [ ] Signatures cover the correct payloads and do not cover themselves
- [ ] Anchors are ordered by slot for L3, and `submitted_at` equals the output anchor block time
- [ ] Public receipt contains no values or PII
- [ ] A failed check is not wired to a slash or payment
- [ ] A third party can verify the receipt using only public data
- [ ] The implementation passes `fixtures/aas-2/`, `fixtures/aas-2/l2/`, and at least one L3 fixture

## 18. License, governance, and conformance claims

- **License.** The specification text and the reference implementation are released under the MIT license in `LICENSE`. Anyone may implement, fork, or sell an implementation without a royalty. The license grants no rights to the Equxi name or logo.
- **Conformance claims.** An implementation may describe itself as "AAS-2 0.1 conformant" only if it passes the fixtures for the ruleset version it declares and completes the checklist in §17. There is no certification body and no fee. A claim is a statement by the implementer, not by Equxi.
- **Governance.** Normative changes follow `GOVERNANCE.md`. In short: a change that alters a pinned hash is a spec change, not an implementation detail, and it needs a versioned fixture and a compatibility note before merge.
- **Independent verifiers.** Equxi is one implementation, not the definition. A verifier written by someone else, reading the same public data and producing the same hashes, is the strongest evidence that this document is sufficient. Reports are recorded through the independent verification issue template in `.github/ISSUE_TEMPLATE/`.
- **No trust claim.** Conformance means the format and checks are implemented correctly. It does not mean the verifier is honest, the data is accurate, or a receipt is legally binding.

---

AAS-1 defines the consequence. AAS-2 defines the proof. Neither is complete without the other.
