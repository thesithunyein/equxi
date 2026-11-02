# AAS-2 mainnet L3 proof

This is a real three-anchor run on Solana mainnet, produced on 2026-11-02 from
the product-feed fixture. It is the first AAS-2 receipt whose evidence lives on
mainnet, and every artifact needed to re-verify it is in this directory except
the verifier private key.

## Result

| Field | Value |
|---|---|
| Receipt core | `sha256:b1f97888e86de051ceb6d2f282eaed81243049c804e19dbfef949c6533645e52` |
| Evidence level | L3 |
| Verdict | `failed_checks` (4 failed records, 16 passed) |
| Submitted at | `2026-11-02T03:13:14Z` (output anchor block time) |
| Verifier key | `keb2jWbISneQIJ1luc9U9NML1Tzat7+3GR9Z7ZssWK0=` (`equxi-aas2-2026-11`) |
| Customer key | `R2P3ooTlktpGK68ohQNVR7sCBLCcEgBwcFXvq+YubKA=` (test only) |
| Provider key | `Ma3bypHw4qKUDdkNAv5uQ8Jw3HZDeNKzoeQlJbqr9lM=` (test only) |
| Mainnet payer | `3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR` |

The payer is the repository's admin key. It paid three memo fees and signed
nothing that affects the receipt. Total fees for the run: 15,000 lamports
(0.000015 SOL).

## Anchors

| Step | Transaction | Slot | Block time |
|---|---|---|---|
| Agreement | `4cptccGogKN1adKy43dp2Rst88JhceRsP7YxBHKzPsGs1a2TvPB5UMpCMNA3PAXr7FGgHo9vs5uwQTER73haPCGN` | 464339794 | 1793589187 |
| Output | `21ySMMPyLNFhgxCkut5pqzyEnJYpkibarfZBXCLeozsYvq5mwXS3CWgV4KjioehzUwqyVAyF2K6P7yqEVDBhGveL` | 464339830 | 1793589194 |
| Receipt | `2Hqq46NoJ9FrSnb19oWX7CHdoe7rvGEjqfMasXzYsEbxKPzBJo3YSFZRbiZ2H7Q9Eh5QFoSKiVgFQQqqkgu4ZE6f` | 464339908 | 1793589211 |

Slots are strictly increasing. The output anchor block time is the deadline
clock the provider signed and the receipt reports. The receipt anchor commits
to the receipt core hash, so it could not be produced before the verdict.

Explorer: `https://explorer.solana.com/tx/<signature>`.

## Verify it

```sh
node aas2.js verify-receipt \
  --receipt fixtures/aas-2/mainnet/receipt.json \
  --agreement fixtures/aas-2/mainnet/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --verifier-key .well-known/equxi-verifier.json \
  --provider-key fixtures/aas-2/mainnet/provider.pub.json \
  --report fixtures/aas-2/mainnet/report.json \
  --rpc https://api.mainnet-beta.solana.com
```

Expected: twelve `PASS` lines and `VALID`, including `submitted_at_clock` and
`anchors_on_chain {"slots":[464339794,464339830,464339908]}`. The on-chain step
reads all three mainnet transactions and checks their memos and slot order
against the receipt.

## How it was produced

The command sequence is the same as `devnet/README.md`, with two substitutions:
the RPC is `https://api.mainnet-beta.solana.com`, and the keys were generated
fresh into `.aas2-mainnet/` so this fixture stands alone. The output anchor block
time was read with `getTransaction` and passed to `sign-submission` as
`--submitted-at`, not taken from the local clock.

## What this proves beyond devnet

- Solana mainnet accepted and finalized the three memos; the slots are public and
  permanent under normal mainnet assumptions.
- The fee assumption is real: 5,000 lamports per memo transaction paid the full
  cost of L3 evidence for this receipt.
- The verifier reads mainnet the same way it reads devnet, with no cluster
  special-casing.

## What it does not prove

- Solana did not execute the AAS-2 checks. The memos are commitments, and the
  receipt is Equxi's signed attestation of the run.
- The customer and provider keys are test keys. They identify no real party.
- The run used the public mainnet RPC. A verifier that trusts a different RPC may
  see a different slot-to-time view during an outage, but not different memos.
- `report.json` contains the fixture's fictional product values. A real delivery
  must keep its report off-chain.
