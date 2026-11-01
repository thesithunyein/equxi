# AAS-2 devnet L3 proof

This is a real three-anchor run on Solana devnet, not a mocked RPC test. It was
produced on 2026-11-01 from the product-feed fixture, and every artifact needed
to re-verify it is in this directory except the verifier private key.

## Result

| Field | Value |
|---|---|
| Receipt core | `sha256:f0df540651a6e6a41fd032f9dfb53d5e1512ae4e25914c8008833ec1c2dd7f38` |
| Evidence level | L3 |
| Verdict | `failed_checks` (4 failed records, 16 passed) |
| Submitted at | `2026-11-01T11:06:27Z` (output anchor block time) |
| Verifier key | `keb2jWbISneQIJ1luc9U9NML1Tzat7+3GR9Z7ZssWK0=` (`equxi-aas2-2026-11`) |
| Customer key | `6cd+XgfQ0Xequ3ZmE4gy1RzeKLNJBidSzRnjHgP9lGs=` (test only) |
| Provider key | `Ay9cPIJQtbdLbZf2ZnNvhvxm7LDtPJKL9dsxRnN98fk=` (test only) |
| Devnet payer | `3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR` |

The payer is the repository's devnet admin key. It paid three memo fees and
signed nothing that affects the receipt.

## Anchors

| Step | Transaction | Slot | Block time |
|---|---|---|---|
| Agreement | `3NgdHnkJ4CbS7Jqa3oJ5Le8mHG4VcAYzJVGJ3rhcseE8Kt141CdgoAa4zDJhduzGynVqmwGq7c9o2UtgoyzcgoV` | 517474123 | 1793531175 |
| Output | `Wp4pNPuxQvy1Rdct7MgR5VkK1Ruf3JYDg3mas4UJHQYWSTYUZvAztwjv37iDkP35cigjiXpB2f1jjyt44RAR7tL` | 517474174 | 1793531187 |
| Receipt | `5cHEwKoeYZU7qANR4X5b3bjvR8mEiG113mrgDtgJmCZnuk232UFoGf4zjLSQoN6nfmHGPcBoAdYzRA6hoPidemp5` | 517474344 | 1793531227 |

Slots are strictly increasing. The output anchor block time is the deadline
clock the provider signed and the receipt reports. The receipt anchor commits
to the receipt core hash, so it could not be produced before the verdict.

Explorer: `https://explorer.solana.com/tx/<signature>?cluster=devnet`.

## Verify it

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

Expected: twelve `PASS` lines and `VALID`, including `submitted_at_clock` and
`anchors_on_chain`. The on-chain step reads all three transactions and checks
their memos and slot order against the receipt.

## How it was produced

```sh
node aas2.js keygen --out .aas2 --name aas2-verifier
node aas2.js keygen --out .aas2-devnet --name customer
node aas2.js keygen --out .aas2-devnet --name provider

node aas2.js sign-agreement \
  --agreement fixtures/aas-2/agreement.product-feed.json \
  --customer-key .aas2-devnet/customer.pem \
  --provider-key .aas2-devnet/provider.pem \
  --out .aas2-devnet/agreement.signed.json

node aas2.js anchor --kind agreement \
  --agreement .aas2-devnet/agreement.signed.json \
  --keypair "$HOME/.config/solana/equxi-admin.json" \
  --rpc https://api.devnet.solana.com \
  --out .aas2-devnet/anchor-agreement.json

node aas2.js anchor --kind output \
  --output fixtures/aas-2/output.product-feed.csv \
  --keypair "$HOME/.config/solana/equxi-admin.json" \
  --rpc https://api.devnet.solana.com \
  --out .aas2-devnet/anchor-output.json

# submitted_at is the output anchor block time, not the local clock.
node aas2.js sign-submission \
  --agreement .aas2-devnet/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --submitted-at 2026-11-01T11:06:27Z \
  --key .aas2-devnet/provider.pem \
  --out .aas2-devnet/submission.devnet.json

node aas2.js verify \
  --agreement .aas2-devnet/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --level L3 \
  --key .aas2/aas2-verifier.pem \
  --provider-sig .aas2-devnet/submission.devnet.json \
  --anchors .aas2-devnet/anchors-agreement-output.json \
  --out .aas2-devnet/l3-pending.json \
  --report-out .aas2-devnet/report.json

node aas2.js anchor --kind receipt \
  --receipt .aas2-devnet/l3-pending.json \
  --keypair "$HOME/.config/solana/equxi-admin.json" \
  --rpc https://api.devnet.solana.com \
  --out .aas2-devnet/anchor-receipt.json

node aas2.js attach \
  --receipt .aas2-devnet/l3-pending.json \
  --anchor .aas2-devnet/anchor-receipt.json \
  --out .aas2-devnet/l3-final.json
```

## What this proves

- The three memos exist on devnet, commit to the expected hashes, and are
  ordered by slot.
- The receipt was signed by the published verifier key after the output anchor
  existed.
- The deadline used the output anchor block time, and the provider signed that
  same time.
- Anyone can rerun the checks and reach the same Merkle root and verdict.

## What it does not prove

- Solana did not execute the AAS-2 checks. The memos are commitments, and the
  receipt is Equxi's signed attestation of the run.
- Devnet is not mainnet. A reorg on devnet would invalidate this specific run.
- The customer and provider keys are test keys. They identify no real party.
- `report.json` contains the fixture's fictional product values. It is committed
  only because this CSV is already public; a real delivery must keep its report
  off-chain.
