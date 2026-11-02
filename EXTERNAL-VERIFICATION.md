# Independent verification

Every AAS-2 receipt so far was checked on the machine that produced it, by the
same person who wrote the verifier. That is demo evidence, not adoption
evidence. This document is the shortest path to changing that.

You do not need to trust Equxi, install a package, or have a wallet. You need
Node 18 or later and, for L3, network access to a Solana RPC.

## 1. Get the code

```sh
git clone https://github.com/thesithunyein/equxi
cd equxi
test ! -d node_modules && echo "no dependencies installed"
```

The verifier and the CLI use only Node built-ins. There is deliberately no
`npm install` step.

## 2. Check the L1 pinned hash

```sh
node aas2.js verify \
  --agreement fixtures/aas-2/agreement.product-feed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --submitted-at 2026-11-15T10:00:00Z \
  --now 2026-11-15T10:00:00Z \
  --ephemeral
```

Pass if the `receipt` line is:

```
sha256:50c0535b9c47eae597cb7f5d89720394600a01005a40d550a996c55c8fbe2eaf
```

The signing key is ephemeral and does not affect that hash. Signatures and
anchors are outside the receipt core by construction.

## 3. Check the L2 receipt

```sh
node aas2.js verify-receipt \
  --receipt fixtures/aas-2/l2/receipt.json \
  --agreement fixtures/aas-2/l2/agreement.signed.json \
  --output fixtures/aas-2/output.product-feed.csv \
  --verifier-key .well-known/equxi-verifier.json \
  --provider-key fixtures/aas-2/l2/provider.pub.json \
  --report fixtures/aas-2/l2/report.json
```

Pass if all ten steps say `PASS` and the last line is `VALID`. The anchor step
says `"not applicable below L3"`.

## 4. Check the devnet L3 receipt

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

Pass if twelve steps say `PASS`, the last line is `VALID`, and
`anchors_on_chain` names slots `517474123`, `517474174`, `517474344`.

## 5. Check the mainnet L3 receipt

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

Pass if twelve steps say `PASS`, the last line is `VALID`, and
`anchors_on_chain` names slots `464339794`, `464339830`, `464339908`.

If a public RPC rate-limits you, retry after a minute or use any RPC provider.
The memos are immutable; a different node returns the same transactions.

## What counts as an independent verification

Use `git rev-parse --short HEAD` and record:

- the commit you cloned;
- your operating system and Node version;
- the four outputs above, or the first failure;
- the language and URL of your own implementation, if you wrote one.

Open an issue using the "Independent verification report" template. A report is
listed in `VERIFIERS.md` after it reproduces the pinned hashes. Listing is not an
endorsement.

## What this proves and what it does not

It proves that the published fixtures, the published key, and the published
on-chain memos are sufficient for someone else to reach the same hashes.

It does not prove that Equxi's verifier is honest, that Solana executed the
checks, that the delivered data is accurate, or that a receipt is legally
binding. Those limits are part of the spec, not bugs in it.
