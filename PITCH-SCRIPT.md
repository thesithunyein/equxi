# PITCH-SCRIPT.md — the two judged videos, word for word

Colosseum's own submission guidance: the **pitch video is the first and most
important item** judges review, and a clean narrative beats production value.
The **technical demo** is where implementation depth is scored. The 75-second
product clip (`DEMO-RUNBOOK.md`) is raw material for both — not a substitute.

Record 1080p, voice-over over screens, no music needed, no buzzwords.

**Slides for the video:** open `deck.html`, then Print → Save as PDF. The page is
preset to one 1280x720 slide per page, the background video is dropped, and the
last slide does not add a blank page. Same export from a terminal:

```
chrome --headless=new --no-pdf-header-footer --print-to-pdf="deck.pdf" \
  https://equxi.sithunyein.com/deck.html
```

---

## Video 1 — Pitch (2:00)

### 0:00–0:12 — Who

> "I'm Sithu Nyein, a solo builder. I wrote every layer of this: the Anchor
> program, the account migration, the TypeScript SDK, the elizaOS plugin, the
> read API, and the site. That full-stack view is the whole point — this product
> is one property enforced across all of them."

### 0:12–0:42 — Problem

> "AI agents now hold wallets and call tools they don't own. Platforms solved
> *permission*: spend caps, allowlists. Nobody solved *consequence*. When an
> agent misbehaves anyway, who pays — and how does a counterparty verify the
> risk before it deals with that agent? Today the answer is: nobody pays, and
> you can't verify anything. That is the gap."

### 0:42–1:12 — Product

> "Equxi is slashable collateral for AI agents on Solana. An operator locks SOL
> behind the agent. A violation is recorded, and the money moves on chain: out of
> the bond, into a program-owned escrow vault, to the victim — no custodian in
> the loop. This is live on devnet: eleven instructions, one hundred and
> eighty CI tests, both upgrades byte-verified, and the full money path
> rehearsed end to end — bond, slash, vault, payout — with every balance
> asserted."

*(Show `prove-compensation.js` final line for ~8 seconds.)*

### 1:12–1:42 — Market and validation

> "The users are the side carrying the risk: API and MCP providers serving
> unknown agents, marketplaces listing third-party agents, frameworks shipping
> wallet-holding agents. A Superteam grant was awarded for the thesis, and this
> repo publishes its own defects — that's the standard. And now the risk has a
> price: the Panta integration builds an agent-slash market whose resolution
> rule cites the same public slash record — quote, build and register are
> exercised against their live API, and test mode is labelled as fixtures."

*(Show `panta-agent-market.js --dry-run` output — or the Explorer card once it lands — with the sandbox label visible. Never present fixtures as a live market.)*

### 1:42–2:00 — Vision and honesty

> "Bond history becomes a credit file, and agent risk becomes something you can
> underwrite. What's deliberately open: detection is off-chain, the slash
> authority is a single key, and escrow is one pool — segregation is roadmap item
> one. We show what isn't done, because that's what makes the rest checkable."

---

## Video 2 — Technical demo (2:30)

| Time | Shot | What the narration establishes |
|---|---|---|
| 0:00–0:25 | Repo tree + `programs/equxi/src` | 11 instructions, 1,216 production lines; where the risk-bearing code lives (`execute_slash`, `compensate_victim`, `withdraw_bond`). |
| 0:25–0:55 | `prove-compensation.js` running live | The money path is asserted, not asserted-about: vault +0.2, bond −0.2, victim +0.2, `/api/trust` read-back. Say what each assertion pins (AAS-1 I1, I4, I5, I11). |
| 0:55–1:20 | `prove-unbonding.js` running live | The exit race: `BondInUnbondingPeriod` after expiry, bond and collateral intact; unit tests walk the boundary a validator clock can't reach. |
| 1:20–1:45 | `api/trust` JSON + `explorer.html` | The read layer: memcmp filters instead of PDA derivation, dependency-free Vercel functions, reconciliation published next to totals (0.2 SOL unescrowed, named). |
| 1:45–2:10 | `panta-agent-market.js --dry-run` + Explorer card | The Panta integration: quote validates auth/params/fee; creation is quote → build → sign → register; resolution source is the Equxi slash record; trade attribution via `/trades/`. |
| 2:10–2:30 | `SPEC.md` + `TEST-RESULTS.md` open problems | Trade-offs made and deferred: off-chain detection, single admin key, single escrow pool; migration verified byte-for-byte; CI as verifier of record. |

### Recording notes

- Use the same terminal hygiene as `DEMO-RUNBOOK.md` (dark theme, 14–16 pt,
  notifications off, never show key material).
- Both terminal segments are re-runnable: fresh agents each take, delta
  assertions, ~0.6 SOL per full take; admin holds ~22 SOL.
- Panta is **fixture mode by decision** (2026-10-05): no real-USDC market was
  created. The honest on-screen moment is the dry-run quote and the CLI's
  sandbox disclaimer. A real market would cost ~50 USDC; do not imply one
  exists, and do not show the fixture title as if it were ours.
- Keep the pitch under 2:00; Colosseum's X account stated the CWF limit is
  2 minutes for pitch video, and the workshop guidance says over-length is a
  common disqualifying mistake.

---

## The two business slides (Market Size + Viability)

Both factors currently sit at ~7 because they are asserted in prose. These two
slides — ~25 seconds each — are what moves them to 8.5+. Every number below is a
third-party estimate with a date: cite it on the slide, mark the two assumptions as
assumptions, and re-check the figures before recording (they drift).

### Slide A — Market size, bottom-up (not "AI is big")

On-screen table:

| Line | Value | Source |
|---|---|---|
| Registered on-chain agent identities | **~650,000** (Sep 23, 2026) | `agenteconomy.to/stats/how-many-ai-agents-are-onchain` — third-party tracker |
| ElizaOS agents / contributors | **50,000+** agents, 1,350+ contributors (mid-2026) | solanacompass project review |
| One platform's agentic GDP | **$477M**, 18,000+ tokenized agents (Apr 2026) | Virtuals; company-defined metric |
| **Assumption:** share of agents that ever handle third-party value | **5%** | ours — say "assume" out loud |
| **Assumption:** average required bond | **$250** | ours — 2.5× our devnet minimum |
| Bonded capital (5% × 650k × $250) | **≈ $8.1M today** | derived |
| Risk layer at 1%/yr of bonded capital | **≈ $81k/yr today** | derived, illustrative |

> "Six hundred and fifty thousand agent identities are registered on chain, and almost
> none of them can prove it is safe to deal with them. Assume five percent ever need a
> verifiable bond, at two hundred and fifty dollars each: eight million dollars of
> collateral, earning a one-percent risk layer — today. That grows with agent commerce:
> one platform alone reports four hundred and seventy-seven million in agentic GDP. And
> the larger market is next, because once bonds exist, bond history is a credit file,
> and premium volume scales with transaction volume, not with agent count."

Why this scores: it is bottom-up, sourced, states its assumptions, and ends on the
factor the judges actually rate — *impact on the market's growth rate*: counterparties
can finally deal with agents they do not own.

### Slide B — Viability (who pays, what is proven, what is open)

On-screen: three revenue lines, then two honesty boxes.

| Line | Who pays | Pricing sketch |
|---|---|---|
| Trust registry + read API | marketplaces, frameworks, MCP providers | per bonded agent per month; the read path is serverless, marginal cost ≈ 0 |
| Bond lifecycle | operators | small issuance fee on the bond — never one that erodes the collateral itself |
| Risk data / underwriting | insurers and risk buyers | licence the bond + slash history as a credit file; later a share of risk-market fees |

> "Viability is three lines. Platforms pay for the registry and API per agent, and the
> read path is serverless, so marginal cost is near zero. Operators pay a small issuance
> fee — never a fee that eats the bond itself. And the bond and slash history becomes a
> credit file that underwriters pay for. What is proven today: the money path is live on
> devnet and asserted end to end, the read API is public, and the mechanism that prices
> the risk is built and exercised. What is honestly not: no external operator yet,
> revenue is zero, and the single admin key is the first thing to decentralise. The next
> twelve months, if funded: mainnet in Q1 2027, one design-partner marketplace, a
> thousand bonded agents, then a first underwriting pilot."

> **Do not read a number off this slide as a forecast.** There is no ARR, no users and
> no token; the slide exists to show the shape of the business and the honesty about
> what is missing — which is exactly what the Viability factor scores.
