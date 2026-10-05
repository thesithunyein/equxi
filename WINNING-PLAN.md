# WINNING-PLAN.md — the honest plan to take 1st where 1st is reachable

Sources checked live on 2026-10-05: `colosseum.com/hackathon` (judging factors),
Colosseum's own submission workshop recap (`blog.colosseum.com/perfecting-your-hackathon-submission/`),
the Panta Sidetrack brief (Superteam Earn), `docs.panta.market` (Quickstart + index),
and the official API Playground repo (`Kaito-HQ/panta-api-playground`).

This file supersedes the demo-only plan where they differ. Nothing here is a promise:
each line is either done, buildable this week, or owned by you.

---

## 0. How to win 1st — the odds, ranked (read this first)

There is no combined leaderboard. The **main track** has its own prizes ($30k grand,
~$300k across ~20 projects; shortlist → 15-minute Zoom interviews), and every sidetrack
has its own winners. "Winning overall" therefore means **taking 1st where 1st is
reachable**, and not spending hours where the rules make it unreachable this cycle.

| Track | Realistic 1st-place odds | What 1st actually requires | Leverage left | Owner |
|---|---|---|---|---|
| **Meteora DBC** | **Strongest** (9.5/10 material) | A judge who follows the on-chain trail: config → curve → partial-fill to the graduation boundary → DAMM v2 migration → claimed proceeds → bond, plus the "a launch funds its own safety escrow" idea | File the form; `launch.html` already renders it | you |
| **CertiK** | **High** (8.5/10) | Testnet-ready code that moves value, an invariant set, and security as a foundation — this repo is evidence, not claims | File the form; link `SECURITY-AUDIT.md` | you |
| **Panta** | **Strong 8 on the sandbox; 9+ only with a paid live market** (7.5 → 8) | Four paid places in a small field. The integration is fully exercised against the live API — but a `pk_test_` key is fixtures, so with no real-USDC spend there is no market and no reported trade | Explorer market card; set `PANTA_API_KEY` so `/api/markets` serves the labeled sandbox catalog; submission copy that states fixture mode plainly | me (card) + you (Vercel env, form) |
| **Main track** | **Shortlist realistic; 1st needs traction** (7.5/10) | Two strong judged videos, a real validation signal, every optional form field filled | record the two videos; one quote | you + me |
| **Adevar** | **Low but free** (6/10) | Codebase complexity + architectural clarity + repo completeness — all present; the tweet is a hard eligibility gate | apply on Superteam Earn, post the tweet, follow | you |
| **RPC Fast** | **Cheap, and it runs to Nov 15, not Oct 12** (~6/10) | Their own rules (verified 2026-10-05): free Focus plan Sep 15 – Nov 15, plus a **post-hackathon sidetrack — 21 teams selected, ~$500 credits each, $10,500 pool** — judged on project, meaningful infrastructure use, community presence *and* impact, with the posting guideline (2–3/month) explicitly "not raw posting volume" | file the 5-step application, claim the free plan, post technical updates through November | you (form) + me (drafts) |
| **Solami** | **Open — can still be entered; one answer decides the build** (~5/10) | Sidetrack is live on Superteam Earn: **$3,000 across 4 winners** for "something live on Solana data" built on their stack (RPC / gRPC / Mirage / Blur / Webhook / Beam). Free key + free RPC tier (no card); streaming tiers are paid/2-day trial, and the stack reads **mainnet-first** | mint the free key, ask whether they serve **devnet** — build the live feed only if they do | you (key) + me (build) |

**Overall, honestly: ~7.2 across the seven listings** (main track + six sidetracks —
Solami was added 2026-10-05, which is why this went from five sidetracks to six). Meteora
and CertiK are the two places first is *reachable*; Panta is an honest 8 whose 9+ needed
the $50 live market (declined); the main track is a realistic *shortlist* whose 1st
depends entirely on traction; RPC Fast and Solami are *out of reach this cycle* for the
same reason — their infrastructure is mainnet-first while the deployment is devnet-only.
The average is not the thing to manage; the tracks that can actually take first are.

### The five moves that change the outcome, in expected-value order

1. **Record the two judged videos** (pitch 2:00, technical demo 2:30). It is both a
   scored factor (Founder Communication) and the **gate on every submission** —
   Colosseum requires a video URL, and no sidetrack can be filed without a Colosseum
   submission. Nothing else is worth starting first.
2. **Submit on Colosseum the day the videos exist.** Complete and early beats perfect
   and late: judging runs in multiple rounds, and the submission link unlocks every
   sidetrack form.
3. **File CertiK and Meteora in the same sitting.** The answers are written
   (`CERTIK-BRIEF.md`, `meteora-launch/README.md`); together under an hour, and these
   are the two strongest 1st-place positions.
4. **Turn Panta from *built* into *used*.** Mint the key, ask the Discord question,
   `--dry-run`, then create one agent-risk market, buy in it, and report the trade.
   A live market price next to the bond it prices is the one thing no other entry can
   copy.
5. **Get one validation signal into the pitch.** One permissioned quote from a real
   builder ("I'd require this before letting an agent touch our API") — Traction is
   the only scored factor with no evidence today, and it is the cheapest point left.

### The schedule that fits Oct 5 → Oct 12

| When | What |
|---|---|
| Oct 5–6 | Mint the Panta `pk_test_` key (free, no card); ask Panta Discord whether test USDC covers create + trade; `--dry-run` the create flow; mint the free Solami key and ask whether they serve devnet; Explorer market card lands **[me]** |
| Oct 6–7 | Create the agent-risk market and buy in it (after their answer); report the trade; price renders next to the bond |
| Oct 7–9 | Record pitch + technical video (`PITCH-SCRIPT.md`, b-roll per `DEMO-RUNBOOK.md`); collect one quote |
| Oct 9 | Submit on Colosseum with everything linked; file CertiK + Meteora; Adevar apply + tweet; RPC Fast 5-step application (minutes, judged to Nov 15); Solami filing only if devnet is confirmed |
| Oct 10–12 | Buffer: judge replies within 24 h, a short "what shipped since submission" update, final claim audit against the chain |

### What "1st" cannot be

- **Guaranteed.** These are judged by people; nothing here is a promise.
- **Won with more code.** Every remaining point lives in filming, filing, and one real
  market — not in another instruction.
- **Won on infrastructure tracks by beating a deadline.** RPC Fast is judged in a
  post-hackathon window that closes Nov 15 with 21 selected teams — file it now and let
  the posts run. Solami is winnable only if their stack serves devnet (unverified); the
  key is free, the question is one Discord message, and the build is one honest
  integration (a live feed of Equxi's program events), not a rewrite.
- **Inflated.** No invented users or volume. The reconciliation warnings, the published
  defect log and `SECURITY-AUDIT.md` are why a judge should believe the rest.

---

## 1. Main track — what Colosseum actually scores

The judged factors (verbatim from `colosseum.com/hackathon`):

| Factor | What it means for Equxi | Status | Gap to close |
|---|---|---|---|
| **Founder + Market Fit** | Solo builder who shipped the whole stack: Anchor program, migration, SDK, elizaOS plugin, dependency-free API, site, tests. Say *why you* — this is a rare full-stack fit for an infra product. | ✅ talk track exists | 30 s of the pitch video |
| **Insight** | The one-liner that proves you see something others don't: *"Platforms solved permission; nobody solved consequence. And now the consequence has a price."* | ✅ unique | Say it in the first 20 s |
| **Product + Execution** | 11-instruction program live on devnet, 180 CI tests, both upgrades byte-verified, read API + badge + explorer + launch page live, both terminal demo flows rehearsed (13/13, 7/7). | ✅ strong | show it, don't describe it |
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

Honest current state (updated 2026-10-05): `/api/markets` covers discovery; the
create/buy/attribute flows are built, tested, and now exercised against the live API
with a real key — but a `pk_test_` key is a **sandbox** (Panta's own disclaimer), so a
*real* market with a *real* price still needs a `pk_live_` key and ~50 USDC. The sandbox
is integration proof; it is not traction, and it must never be presented as if it were.
The 9+ move is the one nobody else can copy: **turn an agent's on-chain bond and slash record into a live, tradable prediction market** — *"Will agent X be slashed before <date>?"* — and show its YES/NO price right next to the collateral it prices.

### The integration map (what to build, endpoint by endpoint)

| Capability | Endpoint (verified against `docs.panta.market`, 2026-10-05) | Equxi use |
|---|---|---|
| Browse | `GET /markets/` | ✅ built (`/api/markets`) |
| Create — quote | `POST /markets/create/quote/` | fee quote for the agent-risk market, in USDC base units (`"50000000"` = 50 USDC) |
| Create — build → sign → broadcast | `POST /markets/create/build/` (unsigned VersionedTransaction) → wallet → RPC | **originality piece**: market titled with the agent name + Equxi bond refs |
| Register | `POST /markets/register/` | after broadcast, with the signature → `marketId` |
| Primary buy | `POST /primaryorderquote/` → `POST /primaryorderbuild/` → sign → `POST /primaryordersubmit/` | trading YES/NO on the agent-risk market |
| Trade attribution | `POST /trades/` | report each demo trade so Panta's metrics see real usage = traction |
| Market detail, positions, claims | exist in Panta's API index, not yet pinned by this repo's tests | wire them when the key lands — do not quote a route this repo has not verified |

### Compliance item (required by their Terms — do not skip)

**"Powered by Panta" must be displayed wherever Panta-powered functionality appears.**
Applied in this commit to the `/api/markets` payload (`attribution` field) and README. The Explorer card must render it too when it is built.

### Action list to Oct 12 (Panta)

- [x] **Minted 2026-10-05** — `pk_test_` key created for `sithunyein.mailto@gmail.com`, stored **outside the repo** (`~/.config/panta/equxi.json`). `/account/` returns `canCreateMarkets: true`, status `active`. Key creation is genuinely free — no card, no payment. **[done]**
- [x] **The test-USDC question is answered by the API itself, not the docs — and the answer is sandbox.** The create quote returns `cr_sandbox_test` + `TestMarket1111…`, the build returns `transaction: ""` with `recentBlockhash: SandboxBlockhash…`, and every response carries *“Test mode: this response uses sandbox fixtures and does not access Solana mainnet.”* Discovery with the key serves one fixture market, “Sandbox test market”. The CLI now detects fixtures and stops with that explanation instead of signing one. **[done]**
- [x] **`pk_live_` key minted and the live path verified (2026-10-05, no spend yet):** quote returns the same **50.00 USDC** (40 platform + 10 liquidity) and a real expected market PDA **`4kDFdr8HLxH4KDjqwc7sZbZLg4HWTZAJXsGUo7KXuKcm`**; build returns a real 1,936-char transaction — ComputeBudget + ATA creation + Panta program `6gM5afTQ…` — fee payer `3zpsb…`. (One live quote hit a transient `INVALID_MARKET_PARAMS` — "check server logs" — and succeeded on retry; worth telling their Discord.) **[done]**
- [x] **Decided 2026-10-05: free only — sandbox, no real-USDC spend.** The live path was verified and one funding step away (`4kDFdr8H…`, 50.00 USDC = 40 platform + 10 liquidity, ~0.01 SOL gas, wallet `3zpsb…` at 0/0 on mainnet). If that decision ever changes, the command is recorded in git history — but the submission must not imply a live market exists. **[decided]**
- [ ] Set `PANTA_API_KEY` in Vercel — with the test key, `/api/markets` serves the labeled sandbox catalog instead of `configured:false`, which is honest, visible integration evidence. **[you or me]**
- [x] **Built 2026-10-05** — `lib/panta.js` + `panta-agent-market.js`: create (quote → build → sign → register) and buy (quote → build → submit → attribute), with `--dry-run` validating auth/params/fee for free, and unit tests pinning every documented route, body and error code. Positions/claim views remain. **[me]**
- [ ] Explorer market card: price, phase, claim eligibility, "Powered by Panta". **[me]**
- [ ] Create the first agent-risk market for a live Equxi agent (value at risk is 1.4 SOL across 6 agents — pick one with a recorded slash for a compelling question). **[you + me]**
- [ ] Demo it in the technical video: market price next to the bond it prices; report the trade via `/trades/`. **[you]**
- [ ] Submission form: answer "how is Panta integrated" with the map above, plus the price screenshot and the market link. **[you]**

### Why this is a strong 8, and exactly what the $50 would have bought

- **Originality** (unchanged): no other submission resolves a market from an on-chain collateral history that already exists; the resolution rule cites the program's own public records, not a news feed.
- **Impact** (unchanged): the same data becomes underwriting input (bond history as credit file) — the "beyond a prediction market destination" story Panta's brief asks for.
- **Traction — where the free-only decision costs us:** with no real-USDC spend there is no created market and no reported trade, and Panta's sandbox disclaimer is explicit that fixtures never touch mainnet. So the submission says that in plain words: routes, bodies, headers, errors and plan constraints are pinned by tests; the whole create path was exercised against the live API; and the market itself is a demonstration, not usage. Nine-plus needed the $50 market; an honest 8 does not pretend otherwise.

---

## 3. Pitch video outline (2:00, ~280 words spoken)

| Time | Beat | Content |
|---|---|---|
| 0:00–0:15 | Who | Solo builder, full-stack shipped: Rust program, migration, SDK, plugin, API, site. Why me: I built and verified every layer. |
| 0:15–0:45 | Problem | Permission vs consequence. Agents now hold wallets and call tools; when they misbehave, nobody pays. Counterparties can't verify risk before dealing. |
| 0:45–1:15 | Insight + product | Collateral, slashable, no custodian: bond → vault → victim, on chain. 11 instructions, live on devnet, 180 CI tests, both upgrades byte-verified. Show `prove-compensation.js` result for 10 s. |
| 1:15–1:45 | Market + validation | Who pays for this: API/MCP providers, marketplaces, frameworks. Signal: Superteam grant awarded; CertiK + Adevar pre-audit applications; live registry read by anyone. New: risk is now *priced* — an agent-slash market on Panta. |
| 1:45–2:00 | Vision + honesty | Bond history becomes a credit file; underwriting for agents. What's deliberately open: off-chain detection, single admin key, single escrow pool — roadmap item 1 is escrow segregation. |

## 4. Honest ceilings (so nothing here over-promises)

- **Main**: without external users, the score ceiling on the startup rubric is set by Founder Communication + Insight + Product. Two strong videos plus one real validation signal are worth more than any additional line of code. Traction stays the weakest factor; do not inflate it.
- **Panta**: 9+ requires a **real** market with a **real** price and a reported trade. That needs your key and a wallet decision. Everything buildable without them is built before you record.
