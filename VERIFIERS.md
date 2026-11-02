# AAS-2 verifier registry

This file lists implementations that have reported reproducing the pinned
fixtures. It is a record of claims, not a certification, and not an endorsement.

## Reference implementation

| Implementation | Language | Maintained by | Fixtures |
|---|---|---|---|
| [equxi/aas2.js](https://github.com/thesithunyein/equxi) | JavaScript (Node) | Equxi | L1, L2, devnet L3, mainnet L3 |

The reference implementation is written by the same maintainer who wrote the
spec. It cannot count as independent evidence for its own correctness.

## Independent implementations

None reported as of 2026-11-02.

To be added, follow `EXTERNAL-VERIFICATION.md`, then open an issue with the
"Independent verification report" template. The report needs a commit, an
environment, the pinned hashes, and the output. A report that only says "works"
will not be listed.

Listing rules:

- The implementation must produce the pinned L1 and L2 hashes and verify at least
  one L3 fixture.
- The report must be reproducible from a public URL or a tarball.
- A listed implementation can be removed if it stops reproducing the fixtures.
- A listing never implies that the implementation is secure, correct for inputs
  outside the fixtures, or operated by Equxi.
