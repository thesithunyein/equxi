# Equxi — CertiK Security Sidetrack submission brief

> Everything in this file is meant to be pasted into CertiK's form or attached to it.
> Every claim links to evidence in the repo or on chain.

- **Project:** Equxi — slashable collateral for AI agents on Solana
- **Repo (public):** https://github.com/thesithunyein/equxi
- **Live site:** https://equxi.sithunyein.com
- **Launch page (Meteora integration):** https://equxi.sithunyein.com/launch.html
- **Program (devnet):** `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`
- **Colosseum submission link:** ⬜ paste once submitted
- **Contact for scoping call:** sithunyein.mailto@gmail.com

## 1. Project, problem, users

Equxi is an economic accountability primitive: operators lock SOL behind an agent
(`create_bond`), the bond is slashable when a rule is broken, and slashed lamports move
`bond → program-owned escrow vault → victim` with no custodian in the loop. The program
holds **only operator collateral** — it is never in custody of user funds.

Platforms solved *permission* for agents (spend caps, allowlists). Nobody solved
*consequence*: who pays when an agent misbehaves anyway, and how can a counterparty verify
that before dealing with it. Equxi's users are the side carrying the risk — API/MCP
providers serving unknown agents, agent marketplaces listing third-party agents, and agent
frameworks shipping wallet-holding agents.

## 2. Audit scope

| Item | Value |
|---|---|
| Target | `programs/equxi/src` |
| Production Rust | **1,216 lines**, **15 files** |
| Framework | Anchor **0.31.2** |
| Instructions | **11** |
| Value at risk today | 1.4 SOL across 6 devnet agents (small, and honestly so) |

Instructions: `initialize`, `create_vault`, `migrate_agent`, `register_agent`,
`create_bond`, `top_up_bond`, `withdraw_bond`, `add_constraint`, `execute_slash`,
`compensate_victim`, `update_trust_score`.

Risk-bearing surfaces to prioritise:

- `execute_slash` — seizes collateral into the vault; must never over-seize or misroute.
- `compensate_victim` — pays out of the vault; must not exceed the record or the vault.
- `withdraw_bond` — fixes the exit race; must not release slashable collateral early.
- `create_vault` / `initialize` — authority binding (admin = program upgrade authority).
- `state.rs` — account layouts, PDA seeds, migration invariants.

## 3. Security posture already in place

- **181 tests in CI** (17 on-chain + 164 validator-free), plus 13 Rust unit tests, across 5
  green CI jobs on every push: build + `anchor test`, Rust unit tests, wire-format, lint,
  structure.
- **Two defects found by verification and fixed in public**, with the evidence in
  [`TEST-RESULTS.md`](TEST-RESULTS.md):
  1. **Reconciliation:** the read API published the sum of slash records as escrow, while
     two records had no lamports behind them. It now publishes the reconciliation next to
     the totals and names the 0.2 SOL discrepancy rather than hiding it.
  2. **Exit race:** `withdraw_bond` accepted `now >= expires_at`, letting an operator exit
     the moment the lock ended and leave a late claim empty. Exit now waits out a 7-day
     unbonding window during which the bond stays slashable (`BondInUnbondingPeriod`),
     with on-chain tests proving the refusal and unit tests pinning every boundary.
- **A third gap closed the same way:** `top_up_bond` records later deposits so the ledger
  (and the score derived from it) can never understate collateral actually at risk.
- **Invariant set:** [`SPEC.md`](SPEC.md) specifies AAS-1, 18 numbered invariants for agent
  accountability; the test suites pin them.
- **Deployments are byte-verified.** Each devnet upgrade is checked against the exact build
  it came from: unbonding window at slot 507390281, `top_up_bond` at slot 507402154.

## 4. Trust boundaries and known limitations (stated, not discovered)

- Detection of violations is **off-chain** today; a slash is an assertion by the admin key.
- The slash authority is a **single key** (the program upgrade authority). Replacing it with
  a staked watcher set is on the roadmap.
- Escrow is a **single pool**: a payout is not yet bound to the collateral seized for the
  record it pays. The read API reports the mismatch it can see. The fix (per-record funding
  marker or per-agent sub-ledger) needs a layout change and migration — roadmap item 1.
- **Devnet only.** Mainnet is gated on post-hackathon funding, and this track's audit
  credit is exactly what de-risks that step.
- No external operators yet; six devnet agents, all created during development.

## 5. Month-by-month roadmap (Nov 2026 → Oct 2027)

**Nov 2026 — freeze and prepare.** Freeze program source at the audited commit. Publish the
audit briefing pack (this document + SPEC + TEST-RESULTS). Close out hackathon submissions;
publish the demo.
**Dec 2026 — escrow segregation design.** Specify the per-record funding marker (or per-agent
sub-ledger) with a migration plan; prototype on a local validator with tests that prove a
payout cannot draw from another agent's collateral.
**Jan 2027 — funding + audit kickoff.** Convert hackathon results into runway (grants /
pre-seed conversations). Begin the security audit with the track's credits; freeze scope.
**Feb 2027 — remediate.** Address audit findings; extend the on-chain suite with a regression
test per finding; keep CI green throughout.
**Mar 2027 — mainnet candidate.** Deploy escrow segregation to devnet behind the migration;
final audit re-check; mainnet-beta deploy if funding closes, otherwise hold on devnet and
publish the readiness evidence either way.
**Apr 2027 — dispute window.** Optimistic slashing: a challenge period plus an arbiter role
before a slash becomes final.
**May 2027 — watcher tooling.** A reference watcher (open source) that detects candidate
violations, proposes slashes, and produces evidence bundles; SDK v1 with typed errors.
**Jun 2027 — registry scale.** Paging/indexing so `getProgramAccounts` limits cannot break
readers; hosted indexer for the public read API.
**Jul 2027 — decentralised slash authority (phase 1).** Move from one key to a bonded,
staked watcher set with slashing for false claims.
**Aug 2027 — on-chain violation proofs (MVP).** A verifiable witness format so a slash can
carry proof, not just an assertion.
**Sep 2027 — integrations.** Marketplaces and frameworks adopt bonding as a listing
requirement; publish integration guides and risk-pricing data on bond history.
**Oct 2027 — underwriting layer.** Bond history as the credit file: risk-pricing products
and the first institutional/API partnerships.

## 6. Team

**Sithu Nyein** — solo builder. Anchor program, escrow design, account migration, TypeScript
SDK, elizaOS plugin, dependency-free read API, trust explorer, and the test suites. GitHub
[`thesithunyein`](https://github.com/thesithunyein), X [`@thesithunyein`](https://x.com/thesithunyein).
Built alongside other work and studies — not full-time yet; funding changes that.

## 7. Fundraising status

Bootstrapped. A **200 USDG Superteam grant has been awarded** and its payout is in progress.
No external round raised, none in progress. Mainnet launch is deliberately gated on
post-hackathon funding — the audit credits offered by this track are the first step of that
plan, not a parallel one.

## 8. Evidence index

| Evidence | Link |
|---|---|
| Repo | https://github.com/thesithunyein/equxi |
| Test results and findings | [`TEST-RESULTS.md`](TEST-RESULTS.md) |
| AAS-1 invariants | [`SPEC.md`](SPEC.md) |
| Unbonding-window upgrade | `5tK2dMyRC9YpKnvGG6PcDPjy1ygEKJeofUAdCgWL3c1jzoGhZQEGdcDHHYkmyP4iQU8WXMJmS5gnixHzb2wYsdho` (slot 507390281) |
| `top_up_bond` upgrade | `QsbAk8qwip1QtMvbm28GupDD3eAHaLGnDpBC48e4zYE7PYfQK5q9Zfrs8fxmz9ieoSQx41jJBsVsmxoC4t6pWrC` (slot 507402154) |
| Live Registry / read API | https://equxi.sithunyein.com/api/trust |
| Meteora DBC launch evidence | [`launch.html`](launch.html) · [`meteora-launch/README.md`](meteora-launch/README.md) |
| CI (verifier of record) | https://github.com/thesithunyein/equxi/actions |
