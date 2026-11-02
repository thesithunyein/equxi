# AAS-2 governance

Status: draft `0.1`, maintained by Equxi. There is one maintainer today:
Sithu Nyein. There is no foundation, no steering committee, and no paid
certification. This document describes the process that exists now and the
conditions under which that process should stop being a single-maintainer one.

## Normative language

"MUST", "SHOULD", and "MAY" are used as in RFC 2119. A statement is normative
only if it changes whether an implementation conforms. Everything else,
including example code and the reference implementation, is informative.

## What a change is

Every change falls into one of four classes.

| Class | What changes | Version effect |
|---|---|---|
| Editorial | Wording, links, examples, typos | None |
| Compatible | Adds an optional field, clarifies existing behavior, adds a check that is off by default | Minor |
| Normative | Changes canonicalization, a check result, a signing payload, or a receipt field | Minor, new ruleset version, new fixture |
| Breaking | Invalidates existing receipts or removes a field | Major |

The test is mechanical: if a pinned hash in `fixtures/aas-2/` changes, the change
is at least normative. A pinned hash change is never a test edit. It is a spec
change that must come with a new fixture version, a note in the pull request
explaining which receipts stop verifying, and an update to this document if the
versioning rule itself changes.

## How a change lands

1. Open an issue describing the problem and which class it is.
2. Open a pull request containing the spec diff, the fixture diff, the reference
   implementation change, and a compatibility note.
3. CI must pass the unit suite, the fixture hash checks, and the on-chain suites.
4. The maintainer merges. For a normative change, the merge commit records the
   old and new fixture hashes.

There is no vote today. When there is more than one maintainer, a normative
change will need approval from two maintainers who did not author it. That rule
is written down now so it cannot be skipped later.

## Versioning

- The spec version is `aas-2/<major>.<minor>`.
- The ruleset version is independent. A receipt names both.
- Old receipts stay valid under the version and ruleset they name. A verifier
  MUST refuse to re-verify a receipt under a different ruleset version.
- `1.0` requires all of the following:
  - two independent implementations, one of them not written by Equxi;
  - at least one independent verification report recorded through the issue
    template;
  - a stable verifier key rotation that has been exercised at least once;
  - an explicit license and governance review by someone other than the
    maintainer.
- Until then the version stays `0.x` and the spec says "draft".

## Verifier keys

The verifier publishes its identity at
`https://www.equxi.tech/.well-known/equxi-verifier.json`.

- Every receipt carries the raw public key inline, so a receipt remains
  verifiable after a key is retired.
- A rotation MUST publish the new key with status `active` and the old key with
  status `retired` for at least one full validity window before revocation.
- A `revoked` key means receipts signed by it should be treated as suspect from
  the revocation time onward. Revocation does not retroactively invalidate
  receipts unless the document says so explicitly.
- The production receipt key MUST be different from the AAS-1 program admin key.

## Independent verifiers

The point of a standard is that the reference implementation is not required.
If you write a verifier in another language or stack:

1. Run it against the pinned fixtures at L1, L2, and L3.
2. Confirm every hash, verdict, and failed index matches.
3. Open an issue using the independent verification template with your
   implementation URL, the fixture versions you ran, and the output.

Equxi will list reported implementations in `VERIFIERS.md` without ranking them.
Being listed is not an endorsement, and failing to be listed does not mean an
implementation is non-conformant.

## Path to neutral governance

Single-maintainer governance is acceptable for a draft. It is not acceptable
for a standard that other parties depend on. The intended transition, in order:

1. Add a second maintainer with merge rights after the first external verifier
   report.
2. Move normative decisions to a two-maintainer approval rule.
3. Consider a foundation or a multi-party working group when at least three
   independent implementations exist.

No date is promised. The trigger is external usage, not time.

## Security and disputes

Report vulnerabilities through `SECURITY.md`. AAS-2 does not define
arbitration, liability, or payment consequences. Those belong to the agreement
and, where relevant, to AAS-1.
