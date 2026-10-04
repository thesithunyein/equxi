# Equxi — Adevar Labs Security Pre-Audit application pack

> Paste-ready answers for the Superteam Earn submission, plus the tweet their rules require.
> Everything here is already evidenced in the repo — the application is assembly, not new work.

## 0. Eligibility checklist (order matters)

1. ⬜ Submit Equxi to the Colosseum Crypto World's Fair — **first**, since their first
   eligibility rule is a Colosseum submission. Paste the submission URL into the answers below.
2. ⬜ Apply on Superteam Earn (Adevar Labs pre-audit track — $4,000 in-kind pre-audit value
   per team, five teams).
3. ⬜ **Post the tweet in §4 from `@thesithunyein`** and follow [`@AdevarLabs`](https://x.com/AdevarLabs).
   The tweet is a hard requirement, not a bonus.
4. ⬜ Keep the repo public (it is) — no access instructions needed.

## 1. Paste-ready answers

**Project name / one-liner.** Equxi — slashable collateral for AI agents on Solana. Operators
lock SOL behind an agent; when a rule breaks, the money moves from the bond, into a
program-owned escrow, to the victim, on chain, with no custodian in the loop.

**Colosseum submission link.** ⬜ paste after submission.

**Problem and target users.** Platforms solved permission for agents (spend caps,
allowlists). Nobody solved consequence — who pays when the agent misbehaves anyway, and how
can a counterparty verify that before dealing with it. Users are the side carrying the risk:
API/MCP providers serving unknown agents, agent marketplaces listing third-party agents, and
agent frameworks shipping wallet-holding agents.

**Why this is a Solana/Rust submission.** A single Anchor program at
`programs/equxi/src`: **1,216 production lines, 15 files, 11 instructions**, Anchor 0.31.2.
Risk-bearing surfaces: `execute_slash`, `compensate_victim`, `withdraw_bond`, `create_vault`,
plus `state.rs`. All instructions and account layouts are specified in [`SPEC.md`](SPEC.md)
(AAS-1, 18 invariants).

**Complexity you would be reviewing (their question).**

- Virtual-clock exit rules: the 7-day unbonding window is a pure function with unit tests
  that pin every branch, including i64 saturation — a rule a local validator's clock cannot
  reach is still tested.
- A live-account migration: v0.1 116-byte agent accounts were grown in place to 118 bytes
  and re-decoded to prove all eight fields survived byte-for-byte.
- Independent read layers (`sdk/src/read.ts` and `lib/equxi-layout.js`) asserted to agree on
  the same accounts, so the wire format cannot drift silently.
- Trust scoring derived only from observable evidence (bond present, size, whether each
  violation was actually paid), with the admin-set on-chain score reported separately.

**Architecture summary.** Five accounts (`Config`, `Vault`, `Agent`, `Bond`, `Constraint`,
plus `SlashRecord`), PDA-seeded, with the escrow vault owned by the program. The flow:
`register_agent → create_bond → add_constraint → execute_slash → compensate_victim`, with
`withdraw_bond` gated by the lock plus the unbonding window. The admin pays to record a
violation (rent + fee) — slashing is a cost centre, never a revenue path.

**Security posture already in place.** 166 tests in CI (17 on-chain + 149 validator-free)
plus 13 Rust unit tests, in 5 green CI jobs on every push. Two defects were found by
verification and fixed in public: the read API publishing slash records as if they were
escrow (it now publishes the reconciliation and names the 0.2 SOL discrepancy), and the exit
race at `expires_at` (closed with an unbonding window, `BondInUnbondingPeriod`). A third gap,
later collateral not recorded in `bond.amount`, was closed by the `top_up_bond`
instruction. Evidence: [`TEST-RESULTS.md`](TEST-RESULTS.md).

**What to audit.** `programs/equxi/src` — 1,216 production lines, 15 files, 11 instructions;
priorities `execute_slash`, `compensate_victim`, `withdraw_bond`, `create_vault`, `state.rs`.

**Known limitations (stated, not hidden).** Detection is off-chain today; the slash authority
is a single key; escrow is a single pool, so a payout is not yet bound to the collateral
seized for the record it pays (the read API reports the mismatch); devnet only; no external
operators yet. Escrow segregation is roadmap item 1.

**Links.** Repo: https://github.com/thesithunyein/equxi · Live:
https://equxi.sithunyein.com · Launch page: https://equxi.sithunyein.com/launch.html

## 2. Evidence index

| Evidence | Where |
|---|---|
| Tests, findings, counts | [`TEST-RESULTS.md`](TEST-RESULTS.md) |
| Invariants and instruction specs | [`SPEC.md`](SPEC.md) |
| Full submission write-up | [`COLOSSEUM-SUBMISSION.md`](COLOSSEUM-SUBMISSION.md) |
| Track-by-track audit | [`TRACK-READINESS.md`](TRACK-READINESS.md) |
| Live read API | https://equxi.sithunyein.com/api/trust |
| Meteora DBC launch (second integration) | [`launch.html`](launch.html) |

## 3. Short note on why the repo qualifies

Their judging is codebase complexity, architectural clarity, repo completeness, and ecosystem
impact. All four already exist: an 11-instruction program with live state and a migration
executed against it, an explicit invariant set, five green CI jobs with 166 tests, LICENSE,
SECURITY.md, and a public defect log — plus a second integration (Meteora DBC) that turns a
token's graduation proceeds into the agent's collateral.

## 4. Required tweet (post from @thesithunyein, then follow @AdevarLabs)

> Just submitted Equxi to the @AdevarLabs Security Sidetrack on @superteamearn for
> @Colosseum's Crypto World's Fair Hackathon — a Slashable-collateral trust layer for AI
> agents on Solana. Excited for the chance to receive a full security Pre-Audit for our
> project. https://github.com/thesithunyein/equxi

Keep the repo link in the tweet; their template expects it.
