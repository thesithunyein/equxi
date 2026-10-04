# WINNING-PLAN.md — the honest checklist for 9+ on Main and Panta

Sources checked live on 2026-10-05: `colosseum.com/hackathon` (judging factors),
Colosseum's own submission workshop recap (`blog.colosseum.com/perfecting-your-hackathon-submission/`),
the Panta Sidetrack brief (Superteam Earn), `docs.panta.market` (Quickstart + index),
and the official API Playground repo (`Kaito-HQ/panta-api-playground`).

This file supersedes the demo-only plan where they differ. Nothing here is a promise:
each line is either done, buildable this week, or owned by you.

---

## 1. Main track — what Colosseum actually scores

The judged factors (verbatim from `colosseum.com/hackathon`):

| Factor | What it means for Equxi | Status | Gap to close |
|---|---|---|---|
| **Founder + Market Fit** | Solo builder who shipped the whole stack: Anchor program, migration, SDK, elizaOS plugin, dependency-free API, site, tests. Say *why you* — this is a rare full-stack fit for an infra product. | ✅ talk track exists | 30 s of the pitch video |
| **Insight** | The one-liner that proves you see something others don't: *"Platforms solved permission; nobody solved consequence. And now the consequence has a price."* | ✅ unique | Say it in the first 20 s |
| **Product + Execution** | 11-instruction program live on devnet, 172 CI tests, both upgrades byte-verified, read API + badge + explorer + launch page live, both terminal demo flows rehearsed (13/13, 7/7). | ✅ strong | show it, don't describe it |
| **Potential Market Size** | Agent economy risk transfer: every marketplace/framework that serves third-party agents is the user. Bond history → credit file → underwriting. | ⚠️ stated in docs | one slide / 20 s |
| **Founder Communication** | The pitch video *is* the score here. Colosseum's workshop says the pitch video is **the first and most important item**, and a clean narrative beats production value. | ❌ not recorded | record it (below) |
| **Viability** | Bond + slash history as a credit file; the Panta market now *prices* the risk live → the business is risk infrastructure, not a dashboard. | ⚠️ newly concrete | 20 s + the market on screen |
| **Traction** | Real signals: 200 USDG Superteam grant awarded (external validation of the thesis), live product with real on-chain history, public filings (CertiK/Adevar). Zero external operators — say so, then say why that's the next 30 days. | ⚠️ modest | **get one validation signal before Oct 12** |

### The two videos (the actual 9+ lever)

Colosseum's guide is explicit:

1. **Pitch video — 2 minutes** (CWF limit; the workshop briefing says ≤3 for Breakout — record 2:00 to be safe).
   It is a *startup pitch*, not a product ad: team background → problem → who it's for → insight → what you built → validation → vision. Voiceover over slides/screens is fine — clarity beats production.
2. **Technical demo video — 2–3 minutes** (new this year): the *how* — architecture, Solana/on-chain decisions, core features, trade-offs, why you prioritized what you did. This is where "11 instructions, escrow vault, unbonding window, byte-verified upgrades, inventory of deliberately-open problems" lands.

The existing **75 s shot list stays** as the product-truth clip (and feeds both videos' b-roll). It is not a substitute for the two judgement videos.

### Action list to Oct 12 (main)

- [ ] Record pitch (2:00) with the outline in §3. **[you + me: script ready below]**
- [ ] Record technical demo (2:30) walking `prove-compensation.js` → `api/trust` → `explorer.html` → `SPEC.md` gaps list. **[you + me]**
- [ ] Record the 75 s product clip per `DEMO-RUNBOOK.md`. **[you]**
- [ ] Get **one** validation signal: a builder quote ("I'd require this before letting an agent touch our API") from the elizaOS / Superteam communities, or a marketplace DM. Log it with permission in one line. **[you]**
- [ ] Fill **every optional field** in the Colosseum form; link repo, live site, videos (public/unlisted), `TEST-RESULTS.md`, `SPEC.md`. **[you]**
- [ ] Post-submission: reply to judge questions within 24 h; a short "what shipped since submission" update helps (the guide says judges may ask about post-hackathon momentum). **[you]**

---

## 2. Panta sidetrack — what actually wins the $5,000 pool

Judged on: **Panta API integration, technical execution, product/UX, originality, impact, traction.**
Four winners (2,000 / 1,000 / 1,000 / 1,000 USDG) — a small field with four paid places.

Honest current state: `/api/markets` covers discovery, and the create/buy/attribute
flows are built and tested (`lib/panta.js`, `panta-agent-market.js`, `--dry-run` works
without spending). Until a key exists and one market is created + traded on chain, the
integration is still *unproven end to end* — which is the difference between 8 and 9+.
The 9+ move is the one nobody else can copy: **turn an agent's on-chain bond and slash record into a live, tradable prediction market** — *"Will agent X be slashed before <date>?"* — and show its YES/NO price right next to the collateral it prices.

### The integration map (what to build, endpoint by endpoint)

| Capability | Endpoint (docs.panta.market) | Equxi use |
|---|---|---|
| Browse | `GET /markets/` | ✅ built (`/api/markets`) |
| Detail + prices | `GET /markets/{marketId}` | card shows YES/NO price |
| Create — quote | `POST /markets/quote/` | fee quote for the agent-risk market (USDC base units) |
| Create — build → sign → broadcast | `POST /markets/build/` (unsigned tx) → wallet → RPC | **originality piece**: market titled with the agent name + Equxi program/bond refs |
| Register | `POST /markets/register/` | after broadcast, with the signature |
| Primary buy | `POST /orders/quote/` → `POST /orders/build/` → sign → submit/verify | trading YES/NO on the agent-risk market |
| Positions | `GET /positions/?wallet=` | Explorer shows a reader's position + claim eligibility |
| Claim winnings / creator fees | `POST /claims/build/` · `POST /claims/creator-fees/build/` | claimable state surfaced in the card |
| Trade attribution | `POST /trades/` · `GET /trades/{signature}/` | report each demo trade so Panta's metrics see real usage = traction |

### Compliance item (required by their Terms — do not skip)

**"Powered by Panta" must be displayed wherever Panta-powered functionality appears.**
Applied in this commit to the `/api/markets` payload (`attribution` field) and README. The Explorer card must render it too when it is built.

### Action list to Oct 12 (Panta)

- [ ] **Mint `pk_test_` key** (free, 5 min): register → `POST /account/keys/ {"env":"test"}` → set `PANTA_API_KEY` in Vercel + locally. **[you]**
- [ ] Ask in **Panta Discord #dev-chat** whether `pk_test_` keys get a test/devnet USDC environment for create + trade, and whether `canCreateMarkets` is enabled. Decide real-USDC (50 USDC fee) only after their answer. **[you]**
- [x] **Built 2026-10-05** — `lib/panta.js` + `panta-agent-market.js`: create (quote → build → sign → register) and buy (quote → build → submit → attribute), with `--dry-run` validating auth/params/fee for free, and unit tests pinning every documented route, body and error code. Positions/claim views remain. **[me]**
- [ ] Explorer market card: price, phase, claim eligibility, "Powered by Panta". **[me]**
- [ ] Create the first agent-risk market for a live Equxi agent (value at risk is 1.4 SOL across 6 agents — pick one with a recorded slash for a compelling question). **[you + me]**
- [ ] Demo it in the technical video: market price next to the bond it prices; report the trade via `/trades/`. **[you]**
- [ ] Submission form: answer "how is Panta integrated" with the map above, plus the price screenshot and the market link. **[you]**

### Why this is 9+ and not 7

- **Originality**: no other submission can resolve a market from a verifiable, on-chain collateral history that already exists. The resolution source is not a news feed — it is a program.
- **Impact**: the same data becomes underwriting input (bond history as credit file). This is the "beyond a prediction market destination" story Panta's brief explicitly asks for.
- **Traction**: a created market + reported trades are visible Panta usage, not a claim.

---

## 3. Pitch video outline (2:00, ~280 words spoken)

| Time | Beat | Content |
|---|---|---|
| 0:00–0:15 | Who | Solo builder, full-stack shipped: Rust program, migration, SDK, plugin, API, site. Why me: I built and verified every layer. |
| 0:15–0:45 | Problem | Permission vs consequence. Agents now hold wallets and call tools; when they misbehave, nobody pays. Counterparties can't verify risk before dealing. |
| 0:45–1:15 | Insight + product | Collateral, slashable, no custodian: bond → vault → victim, on chain. 11 instructions, live on devnet, 172 CI tests, both upgrades byte-verified. Show `prove-compensation.js` result for 10 s. |
| 1:15–1:45 | Market + validation | Who pays for this: API/MCP providers, marketplaces, frameworks. Signal: Superteam grant awarded; CertiK + Adevar pre-audit applications; live registry read by anyone. New: risk is now *priced* — an agent-slash market on Panta. |
| 1:45–2:00 | Vision + honesty | Bond history becomes a credit file; underwriting for agents. What's deliberately open: off-chain detection, single admin key, single escrow pool — roadmap item 1 is escrow segregation. |

## 4. Honest ceilings (so nothing here over-promises)

- **Main**: without external users, the score ceiling on the startup rubric is set by Founder Communication + Insight + Product. Two strong videos plus one real validation signal are worth more than any additional line of code. Traction stays the weakest factor; do not inflate it.
- **Panta**: 9+ requires a **real** market with a **real** price and a reported trade. That needs your key and a wallet decision. Everything buildable without them is built before you record.
