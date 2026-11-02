# AAS-2 fixture: product feed

This is the first reference fixture for [AAS-2](../../AAS-2.md). It pins the five
v0.1 checks and the content hashes, so the spec and the fixture, not a private
implementation, define the expected result.

## Files

| File | Purpose |
|---|---|
| `agreement.product-feed.json` | The agreement: 20 records, five checks, a 2026-12-01 deadline |
| `submission.json` | Fixed fixture clock and provider id, unsigned submission |
| `output.product-feed.csv` | 20 fictional product records with four known failures |
| `expected.json` | Expected per-check results, failed record indices, verdict, and content hashes |

## The four failures

| Record index | Failure | Check |
|---|---|---|
| 3 | `category` is empty | `required_fields` |
| 8 | `price` is `n/a`, not a decimal | `field_types` |
| 10 | `category` is empty | `required_fields` |
| 16 | `sku` `SKU-0002` repeats record 1 | `unique` |

Record count passes (20 of 20). Deadline passes (submitted 2026-11-15, due 2026-12-01).
The verdict is `failed_checks` with 4 failed records and 16 passing records.

The duplicate rule is first-occurrence-wins: record 1 passes, record 16 is the extra.

The expected receipt is L1: it will carry only the verifier signature, with no
provider signature and no anchors. The deadline uses a fixture clock and the
receipt limits must say so.

## How to use it

A conforming verifier should:

1. Parse `output.product-feed.csv` by header name.
2. Canonicalize the records per AAS-2 §6.
3. Run the five checks in the agreement.
4. Compare the summary, failed indices, verdict, and every hash with `expected.json`.
5. Produce a receipt with `evidence_level: "L1"` and a `limits` line saying the
   deadline used a fixture clock.

The reference implementation runs it in one command:

```sh
node aas2.js keygen --out .aas2
node aas2.js verify \
  --agreement fixtures/aas-2/agreement.product-feed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --submitted-at 2026-11-15T10:00:00Z --now 2026-11-15T10:00:00Z \
  --key .aas2/aas2-verifier.pem \
  --out .aas2/receipt.json --report-out .aas2/report.json
```

The signature key does not affect the pinned hashes: `anchors` and `signatures`
are outside `receipt_core` (AAS-2 P14), so any valid Ed25519 key produces the
same core hash.

## The pinned hashes

`expected.json` pins the six content hashes plus the receipt core:

| Field | Value |
|---|---|
| `agreement` | `sha256:13e38c6f…78d231` |
| `raw_output` | `sha256:55eb7222…7e25af` |
| `canonical_records` | `sha256:06a7b1ac…3153ee` |
| `merkle_root` | `sha256:8744dd36…513828` |
| `ruleset` | `sha256:6f93f757…60250d6` |
| `report` | `sha256:c19b3d3e…35688811` |
| `receipt_core` | `sha256:50c0535b…be2eaf` |

The hashes assume `created_at` equals `submitted_at`, both the fixture clock, and
evidence level L1. Changing any of those changes `receipt_core` and `report`, by
design.

The Merkle root commits to records, per-record check results, and the ruleset
hash. It is not a root over records alone (AAS-2 P7). A selective-disclosure
proof for record 16 verifies against that root in three steps:

```sh
node aas2.js prove --agreement fixtures/aas-2/agreement.product-feed.json \
  --output fixtures/aas-2/output.product-feed.csv --index 16 \
  --submitted-at 2026-11-15T10:00:00Z --out .aas2/proof-16.json
node aas2.js check-proof --proof .aas2/proof-16.json
```

## Live L3 proofs

`devnet/` holds a real three-anchor run on Solana devnet from 2026-11-01.
`mainnet/` holds the same flow on Solana mainnet from 2026-11-02, with fresh test
keys and a different receipt core because the output anchor block time differs.
Both contain the signed agreement, the provider submission, the three
transactions with their slots, the private report, and the final L3 receipt.

The devnet receipt verifies with:

```sh
node aas2.js verify-receipt \
  --receipt fixtures/aas-2/devnet/receipt.json \
  --agreement fixtures/aas-2/devnet/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --verifier-key .well-known/equxi-verifier.json \
  --provider-key fixtures/aas-2/devnet/provider.pub.json \
  --report fixtures/aas-2/devnet/report.json \
  --rpc https://api.devnet.solana.com
```

All twelve steps pass, including `submitted_at_clock` and `anchors_on_chain`.
See `devnet/README.md` for the transactions and the limits of what the run
proves. `mainnet/README.md` documents the mainnet run and its slots; the verify
command differs only in the fixture directory and the RPC URL.

## Why this fixture

It is boring on purpose. A product feed is a real AI delivery, the failures are
the kind a buyer actually finds by hand, and every failure is objective. If a
verifier cannot get this right, it cannot be trusted with a dispute.
