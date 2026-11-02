# AAS-2 L2 fixture

This fixture pins the middle evidence level: a signed agreement, a provider
submission signature, and a verifier receipt, with no on-chain anchors. L1 only
has a verifier signature; L3 adds the three memos. L2 is the level a buyer can
use before paying for mainnet fees.

## Result

| Field | Value |
|---|---|
| Receipt core | `sha256:2a9fe1110ba7f6aa545d47c31cbe3b21b2e3447f210fce80b692db9bcf06b74f` |
| Evidence level | L2 |
| Verdict | `failed_checks` (4 failed records, 16 passed) |
| Submitted at | `2026-11-15T10:00:00Z` (fixture clock, provider-signed) |
| Verifier key | `keb2jWbISneQIJ1luc9U9NML1Tzat7+3GR9Z7ZssWK0=` (`equxi-aas2-2026-11`) |
| Customer key | `94glSSe8FgTXM3mc4zEtW+DoUwp+oQTR29AOusSBvJE=` (test only) |
| Provider key | `3gLJMV58OVRtD4kw7reLOu9ckYGt1PIQG5Bo7Tg4OW0=` (test only) |

## Files

| File | Purpose |
|---|---|
| `agreement.signed.json` | The product-feed agreement, signed by customer and provider |
| `submission.json` | The provider's signature over the agreement hash, output hashes, and `submitted_at` |
| `receipt.json` | The final L2 receipt |
| `report.json` | The private report with record values |
| `customer.pub.json`, `provider.pub.json` | Public halves of the test keys |
| `expected.json` | Pinned hashes, check results, and signature keys |

## Verify it

No network and no install are needed. The only requirement is Node 18 or later.

```sh
node aas2.js verify-receipt \
  --receipt fixtures/aas-2/l2/receipt.json \
  --agreement fixtures/aas-2/l2/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --verifier-key .well-known/equxi-verifier.json \
  --provider-key fixtures/aas-2/l2/provider.pub.json \
  --report fixtures/aas-2/l2/report.json
```

Expected: ten `PASS` lines and `VALID`. The anchor step reports
`"not applicable below L3"`. There is no `--rpc` because L2 makes no on-chain
claim.

## What L2 adds over L1

- The customer and provider both signed the exact agreement, so neither can
  substitute terms after the fact.
- The provider signed the submitted output hashes and the timestamp, so the
  verifier is not the only party asserting when the delivery happened.
- The receipt still carries the verifier's signature and the same Merkle root,
  so per-record disclosure works unchanged.

## What it does not prove

- The timestamp is provider-asserted, not chain-verified. A provider could sign
  an earlier time and the verifier would accept it at L2.
- No ordering against the agreement is claimed. Without anchors there is no
  public evidence that the agreement existed before the output.
- The keys are test keys and identify no real party.

L3 closes the timestamp and ordering gaps. See `../devnet/README.md` and
`../mainnet/README.md`.

## How it was produced

```sh
node aas2.js keygen --out .aas2-l2 --name customer
node aas2.js keygen --out .aas2-l2 --name provider

node aas2.js sign-agreement \
  --agreement fixtures/aas-2/agreement.product-feed.json \
  --customer-key .aas2-l2/customer.pem \
  --provider-key .aas2-l2/provider.pem \
  --out .aas2-l2/agreement.signed.json

node aas2.js sign-submission \
  --agreement .aas2-l2/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --submitted-at 2026-11-15T10:00:00Z \
  --key .aas2-l2/provider.pem \
  --out .aas2-l2/submission.json

node aas2.js verify \
  --agreement .aas2-l2/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --level L2 --submitted-at 2026-11-15T10:00:00Z --now 2026-11-15T10:00:00Z \
  --key .aas2/aas2-verifier.pem \
  --provider-sig .aas2-l2/submission.json \
  --out .aas2-l2/receipt.json --report-out .aas2-l2/report.json
```

The content hashes match the L1 fixture because the agreement, output, and
ruleset are identical. Only `receipt_core` changes, because the evidence level
and provider signature are part of the core.
