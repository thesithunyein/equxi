# PITCH-SCRIPT.md — the two judged videos, word for word

Colosseum's own submission guidance: the **pitch video is the first and most
important item** judges review, and a clean narrative beats production value.
The **technical demo** is where implementation depth is scored. The 75-second
product clip (`DEMO-RUNBOOK.md`) is raw material for both — not a substitute.

Record 1080p, voice-over over screens, no music needed, no buzzwords.

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
> seventy-two CI tests, both upgrades byte-verified, and the full money path
> rehearsed end to end — bond, slash, vault, payout — with every balance
> asserted."

*(Show `prove-compensation.js` final line for ~8 seconds.)*

### 1:12–1:42 — Market and validation

> "The users are the side carrying the risk: API and MCP providers serving
> unknown agents, marketplaces listing third-party agents, frameworks shipping
> wallet-holding agents. A Superteam grant was awarded for the thesis, and this
> repo publishes its own defects — that's the standard. And now the risk has a
> price: on Panta, anyone can trade whether a specific agent gets slashed before
> a date, resolved from the same public slash record."

*(Show the Explorer card with the market price next to the bond, once the key lands.)*

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
- If Panta key lands: add the created market's YES/NO price on screen — it is
  the single strongest 10 seconds available to the pitch (risk, priced).
- Keep the pitch under 2:00; Colosseum's X account stated the CWF limit is
  2 minutes for pitch video, and the workshop guidance says over-length is a
  common disqualifying mistake.
