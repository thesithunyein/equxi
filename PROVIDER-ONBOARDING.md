# Running one real AAS-2 delivery

This is the shortest path to a receipt where the customer and the provider are
not Equxi. Until that exists, every receipt in the repository is a demonstration
produced by the same person who wrote the verifier.

The flow below uses the reference verifier. A second verifier is welcome and
does not change the steps.

## Who does what

| Party | Provides | Never provides |
|---|---|---|
| Customer | Agreement terms, customer public key | Output data before the deadline |
| Provider | Output file, provider public key, submission signature | Customer's private key |
| Verifier | Deterministic checks, signed receipt, optional anchors | Judgment about factual accuracy |

The verifier is not an escrow, an arbitrator, or a payment rail. A failed check
is a verification result that the parties can act on. It is not a legal finding.

## Choose a level before signing

| Level | Cost | Timeline evidence | Use when |
|---|---|---|---|
| L2 | 0 | Provider-asserted | Both parties know each other and want a signed record |
| L3 | 0.000015 SOL | Anchor block time | The deadline matters or the provider is not trusted |

L3 needs a funded Solana key. On mainnet that is one cent per receipt at current
fees, so the cost is not the reason to skip it.

## Step 1: write the agreement

Start from `fixtures/aas-2/agreement.product-feed.json`. Change:

- `parties`: customer and provider identifiers.
- `deliverable`: the fields, types, and count the provider must deliver.
- `checks`: the five v0.1 checks, or a subset. Each check is deterministic.
- `deadline`: an RFC 3339 timestamp.

Keep a copy of the agreement JSON. Its hash, not its wording, is what the
receipt binds.

## Step 2: create keys

```sh
node aas2.js keygen --out customer-key --name customer
node aas2.js keygen --out provider-key --name provider
```

Each command writes a private PEM and a public JSON. Send only the public JSON
to the other parties. The customer's private key stays with the customer, and
the provider's private key stays with the provider.

## Step 3: sign the agreement

The customer signs first, then sends the signed agreement to the provider, who
adds its signature:

```sh
# customer
node aas2.js sign-agreement \
  --agreement agreement.json \
  --customer-key customer-key/customer.pem \
  --out agreement.customer.json

# provider, after receiving agreement.customer.json
node aas2.js sign-agreement \
  --agreement agreement.customer.json \
  --provider-key provider-key/provider.pem \
  --out agreement.signed.json
```

The provider adds its signature to the file the customer signed. The customer's
private key never leaves the customer, and the provider's never leaves the
provider. A valid L2 or L3 receipt requires both signatures.

## Step 4: anchor the agreement (L3 only)

```sh
node aas2.js anchor --kind agreement \
  --agreement agreement.signed.json \
  --keypair ~/.config/solana/id.json \
  --rpc https://api.mainnet-beta.solana.com \
  --out anchor-agreement.json
```

The anchor is a memo transaction. It stores no agreement content and no
personal data. Save `anchor-agreement.json`; the receipt needs it.

## Step 5: deliver the output

The provider sends the output file and a submission signature. At L3 the
timestamp must be the output anchor block time, so anchor the output first:

```sh
node aas2.js anchor --kind output \
  --output delivery.csv \
  --keypair ~/.config/solana/id.json \
  --rpc https://api.mainnet-beta.solana.com \
  --out anchor-output.json

node aas2.js sign-submission \
  --agreement agreement.signed.json \
  --output delivery.csv \
  --submitted-at <output anchor block time, RFC 3339> \
  --key provider-key/provider.pem \
  --out submission.json
```

At L2, replace the anchor step with the agreed submission time and skip the
anchor file.

## Step 6: issue the receipt

```sh
node aas2.js verify \
  --agreement agreement.signed.json \
  --output delivery.csv \
  --level L3 \
  --key verifier.pem \
  --provider-sig submission.json \
  --anchors anchors-agreement-output.json \
  --out receipt.pending.json \
  --report-out report.private.json
```

`report.private.json` contains the delivery values. Keep it off-chain. The
receipt itself contains hashes, counts, and indices.

## Step 7: anchor the receipt (L3 only)

```sh
node aas2.js anchor --kind receipt \
  --receipt receipt.pending.json \
  --keypair ~/.config/solana/id.json \
  --rpc https://api.mainnet-beta.solana.com \
  --out anchor-receipt.json

node aas2.js attach \
  --receipt receipt.pending.json \
  --anchor anchor-receipt.json \
  --out receipt.json
```

## Step 8: verify as the customer

The customer reruns the public verifier with no private key:

```sh
node aas2.js verify-receipt \
  --receipt receipt.json \
  --agreement agreement.signed.json \
  --output delivery.csv \
  --verifier-key .well-known/equxi-verifier.json \
  --provider-key provider.pub.json \
  --report report.private.json \
  --rpc https://api.mainnet-beta.solana.com
```

A valid result means the hashes, signatures, clock, and anchors agree. It does
not mean the data is true.

## What to send Equxi

To make the receipt public as the first external agreement, send:

- the signed agreement;
- the output file, or its hash if the data is private;
- `submission.json`, `anchor-agreement.json`, `anchor-output.json`,
  `anchor-receipt.json`, and `receipt.json`;
- confirmation from both parties that the identifiers may be published.

Do not send private keys. The verifier never needs them, and no step in this
document requires sharing one.

## Current status

As of 2026-11-02 there is no external agreement. The fixtures under
`fixtures/aas-2/` use test keys and fictional product data. A real receipt from
two unrelated parties would be the first evidence that AAS-2 is used, not only
implemented.
