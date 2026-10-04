# Equxi — Colosseum submission

> **Slashable collateral for AI agents on Solana.** Operators lock SOL behind an agent;
> when it breaks a rule, the money moves — from the bond, into escrow, to the victim —
> on chain, with no custodian in the loop.

- **Builder:** Sithu Nyein — [GitHub](https://github.com/thesithunyein), [X](https://x.com/thesithunyein)
- **Live:** https://equxi.sithunyein.com
- **Program (devnet):** `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`
- **Repo:** https://github.com/thesithunyein/equxi
- **Packages:** `@equxi/sdk`, `@equxi/plugin-eliza` on npm
- **Standard:** [AAS-1](SPEC.md) — 18 numbered invariants for agent accountability

---

## 1. Founder + market fit

I build agent infrastructure and have shipped the whole stack here myself: the Anchor
program, the escrow vault, a 116 → 118 byte account migration executed against live
state, the TypeScript SDK, an elizaOS plugin, a dependency-free read API, a trust
explorer, and the test suite that pins all of it. The interest is specific: agents are
being handed wallets and paid API access faster than anyone is building the layer that
decides **who pays when they misbehave**.

## 2. Insight

**Platforms solved permission. Nobody solved consequence.**

Every agent tooling product ships spend caps, allowlists and approval prompts — they
answer *"what is this agent allowed to do?"*. None answer *"who pays when it does the
wrong thing anyway?"* A spend cap limits loss; it does not compensate anyone. And
reputation is free to lose: burn a rating, register a new key, clean slate in the same
block.

The insight is that accountability is an **economic** primitive, not a permission one.
An agent that can be held liable needs collateral at risk, a rule it broke, and a payout
path to whoever it hurt — and all three have to be verifiable by the counterparty
**before** it does business with that agent.

## 3. Product + execution

**What is live on devnet today.** Eleven instructions, a program-owned escrow vault, and a
public read path:

```
register_agent → create_bond → add_constraint → execute_slash → compensate_victim
                     │                │               │                │
                  locks SOL      records rules    moves to vault    pays victim
```

**The claim, with transactions.** This is the part most accountability pitches cannot
show. On 2026-10-04 the money moved end to end on devnet:

| Step | Transaction | Slot | Balance effect |
|---|---|---|---|
| Lock 0.5 SOL bond | `3Y9cUQaq…` | 507271408 | bond **+0.5012** |
| `execute_slash` 0.2 SOL | `5otbo1PB…` | 507271413 | bond **−0.2000**, vault **+0.2000** |
| `compensate_victim` 0.2 SOL | `djWtG284…` | 507271417 | vault **−0.2000**, victim **+0.2000** |

The victim's account history is a single incoming transfer, so there is no ambiguity
about provenance. Full record, including the AAS-1 invariants checked against live
account bytes: [`TEST-RESULTS.md`](TEST-RESULTS.md).

**Non-custodial by construction.** Slashed funds go to a program-owned vault, never to the
admin. The admin *pays* to record a violation (1,965,960 lamports of rent for the slash
record, plus fee) — slashing is a cost centre, never a revenue path.

**The read path is the product.** A counterparty's real question is not "how does the
program work" but *does this agent have collateral at risk, and has it ever been slashed?*

- `GET /api/trust` — JSON, dependency-free Vercel function, one call for a whole registry
- `GET /api/badge` — live SVG badge any agent can wear, re-read from chain every request
- Trust Explorer — sort by collateral, weakest score, slash count; audit the score ledger

**The score is derived, not asserted.** Grade comes only from observable evidence: whether
a bond is posted, how large, and whether each recorded violation was actually paid. The
on-chain `trust_score` field is admin-set, so it is reported separately and never used as
an input. Every score ships a breakdown that sums exactly to the total, so it can be
checked rather than trusted.

**Engineering discipline.** 149 validator-free unit tests plus a 17-test on-chain suite
(166 total) in CI; a migration that grew live accounts in place and re-decoded each one
to prove all eight fields survived byte-for-byte; an SDK defect found by reading the
published artifact back from npm rather than trusting the build.

**The launch integration, on chain.** A token launch that creates its own accountability:
[`meteora-launch/`](meteora-launch/README.md) builds a Meteora DBC config where half of
trading fees and half of a 10% migration fee belong to the launch, drives the curve to 100%
with a partial-fill buy, migrates the pool to DAMM v2, claims the graduation proceeds
(0.0698 SOL), and posts them as the launched agent's Equxi bond — read back as **A / 92**
through the public API. Ten devnet transactions, all linked, including the two things
the run taught us that the docs do not say: a buy that would cross the graduation threshold
must be a partial fill, and trading fees must be claimed *before* graduation because
migration takes the fee vaults with it.

**Two defects the verification caught, both fixed.** The read API was publishing the sum
of slash records as if it were money in escrow, while two of those records had no lamports
behind them — it now publishes the reconciliation next to the totals and names the 0.2 SOL
that is recorded but never deposited. And `withdraw_bond` accepted `now >= expires_at`, so
an operator could exit the instant the lock ended and leave a late claim an empty account;
exit now waits out a 7-day unbonding window in which the collateral stays slashable, with a
separate error code so a client can tell "too early" from "expired, but still slashable".
Both are recorded in [`TEST-RESULTS.md`](TEST-RESULTS.md), with the on-chain tests that
prove the refusals and the unit tests that pin the boundary a local validator cannot
reach.

**A gap closed the same way.** `create_bond` was the only door collateral could enter
through, so deposits made afterwards stayed invisible to `bond.amount` — the ledger, the
read API and the derived score all understated what was actually at risk. `top_up_bond`
now moves the lamports and records them in one signed, operator-only step, and it is
live on devnet with on-chain tests proving both halves.

## 4. Market size

Every agent that touches money needs this, and the buyers are already shipping products
that need it today:

- **API & MCP providers** — price the risk of serving an unknown agent before spending compute
- **Agent marketplaces** — bonding as a listing requirement moves liability to the operator
- **Agent frameworks** — a trust module wallet-holding agents can adopt instead of building compliance

The wedge is agent *payments*, which is where the volume is heading, and the natural
expansion is becoming the underwriting layer for agent-to-agent commerce: once bonds are
a listing requirement, the bond data is the credit file.

## 5. Viability

The protocol holds **only operator collateral**, which keeps it out of money-transmission
territory. It layers on top of permission systems rather than competing with them, so it
can be adopted without replacing anything a platform already ships — that is what makes it
a business rather than a feature. Revenue paths that follow naturally: a cut of slash
resolution fees, bonding-as-a-service for marketplaces, and risk pricing on bond history.

## 6. Traction (honest)

Three agents on devnet, all created during development — including `EAGT`, whose bond was
funded by a Meteora DBC launch that graduated on devnet the same day. Two independent implementations of
the read layer (`sdk/src/read.ts` and `lib/equxi-layout.js`) are asserted to agree, and the
SDK is published so an outside developer can install and use it today. There are no
external operators or revenue yet — this is a working primitive with real proof, not a
business with users, and the next milestone is exactly that conversion.

## 7. Roadmap

**Also shipped since the first draft: a Meteora DBC launch that funds an agent's bond.**
`meteora-launch/` runs a real devnet launch whose graduation proceeds become slashable
collateral; the evidence is in `meteora-launch/README.md` and `TRACK-READINESS.md`.

**Closed since this document was first written: the expiry race.** `withdraw_bond` used to
accept `now >= expires_at` while `execute_slash` rightly ignores expiry, so an operator
could leave before a late claim landed. Exit now requires a 7-day unbonding window past
expiry — `BondInUnbondingPeriod` — during which the bond stays slashable, and the on-chain
suite proves both halves of it. Both Rust changes are deployed: the window went live on devnet on 2026-10-04, and
`top_up_bond` followed the same day — each byte-verified against its source build.

1. **Segregate escrow per agent.** One vault pool backs every record, and a `SlashRecord`
   does not record whether its own lamports ever arrived, so a payout for an unfunded
   record can draw on collateral seized from a different agent. The read API already
   reports the mismatch; the fix — a per-record funding marker or a per-agent sub-ledger —
   needs an account layout change and a migration.
2. **On-chain violation proofs.** Detection is off-chain today; a slash is asserted. A
   verifiable witness is the next real primitive.
3. **Dispute window.** Optimistic slashing with a challenge period and an arbiter.
4. **Decentralised slash authority.** Replace the single admin key with a staked watcher set.
5. **Registry paging.** `getProgramAccounts` caps around 850 accounts before the RPC
   refuses; a conforming reader should page or index.

## 8. Demo video script (75s)

| Time | Shot | Voiceover |
|---|---|---|
| 0:00–0:06 | Landing page, headline only | "Platforms solved permission for AI agents. Nobody solved consequence." |
| 0:06–0:16 | Trust Explorer, Augur's panel open | "This agent posted collateral on Solana. A counterparty can read its bond and its slash history in one call — before serving it." |
| 0:16–0:24 | Score ledger expanded | "The grade is derived from evidence, not asserted by an admin — and the breakdown sums to the number, so it can be checked." |
| 0:24–0:40 | Terminal: `prove-compensation.js` — a live slash and payout | "A violation is recorded. Watch the collateral: out of the bond, into a vault the admin cannot touch — and out to the victim." |
| 0:40–0:50 | Terminal: `prove-unbonding.js` — a bond created with a 1-second lock, then withdrawn at expiry, refused with `BondInUnbondingPeriod` | "Exit is not instant. For seven days past the lock, the collateral is still there to be seized." |
| 0:50–1:02 | `launch.html` — the Meteora DBC launch page, EAGT read back as A / 92 | "A Meteora launch whose graduation proceeds became the agent's bond — ten transactions, all on chain." |
| 1:02–1:10 | `/api/trust` JSON and badge for the slashed agent | "The same registry reports it all publicly, with no privileged access." |
| 1:10–1:15 | Close on the landing page | "Detection is still off-chain and the admin is still one key — the next two things to fix." |

Both terminal segments were rehearsed end-to-end on live devnet on 2026-10-04:
`prove-compensation.js` passes 13/13 assertions in 6.6s and `prove-unbonding.js` passes 7/7
in 7.3s. Exact commands, expected on-screen lines, per-take SOL costs and fallbacks are in
[`DEMO-RUNBOOK.md`](DEMO-RUNBOOK.md).

## 9. What is not done

Stated deliberately, since a judge will find it anyway: detection is off-chain; the slash
authority is a single key; escrow is a single pool, so a payout is not bound to the
collateral seized for the record it pays (the read API reports the mismatch it can see);
the launch flow is script-driven with an evidence page, not a hosted launchpad; and there
is no external operator yet. Everything in section 3 is verifiable today.
