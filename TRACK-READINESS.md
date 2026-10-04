# Track readiness audit — where Equxi stands against each track's own rules

Checked 2026-10-04 against the six listings (Colosseum main track, CertiK, Meteora DBC,
Adevar Labs, Panta, RPC Fast). Every "status" below is a fact measured in this repository,
not an intention. Placeholders marked **⬜** are things only you can supply.

Measured for the audits that ask for scope:

| Asset | Size |
|---|---|
| `programs/equxi/src` (production Rust, audit target) | **1,216 lines**, 15 files, 11 instructions + state + errors |
| Inline Rust unit tests in that crate | 167 lines |
| On-chain test suite `tests/equxi.test.ts` | 664 lines (17 cases) |
| Validator-free unit tests `tests/unit/*` | 2,904 lines (149 cases) |
| `sdk/src` (TypeScript SDK) | 1,011 lines |
| `eliza-plugin/src` | 1,329 lines |
| Deployment | **devnet only** — `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc` |
| CI | 5 jobs green: build + `anchor test` (166 passing), Rust unit tests, wire-format, lint, structure |

## 0. Cross-track blockers, in the order they must happen

1. **The demo video does not exist anymore.** `C:\Users\sithu\equxi-demo\` is gone, and an
   exhaustive search of `C:\Users\sithu` plus every other drive finds no Equxi clip — the
   only `.webm`/`.mp4` files on the machine belong to other projects. **Before
   re-recording, look wherever the clips were sent** (Telegram, Viber, Drive): three of the
   four segments existed as finished files (01-landing 24.6s, 02-explorer 109s, 03-api
   46s), and only the 0:32–0:52 terminal segment was never recorded. A recovery would
   leave exactly that one segment to shoot; either way it needs the admin key and a live
   slash run to show the collateral actually moving. Every track judges a working demo, and
   Colosseum requires a video URL at submission — **this is the highest-risk item**.
2. **Submit on the Colosseum dashboard first.** CertiK asks for the Colosseum submission
   link, Panta requires submission to both, RPC Fast requires submission to both, and
   Adevar's *first eligibility rule* is a Colosseum submission. Nothing else can be filed
   until that link exists.
3. ~~**The unbonding window is source-only.**~~ **Closed 2026-10-04.** Devnet now runs the
   unbonding window (upgrade tx `5tK2dMyR…`, slot 507390281) and `top_up_bond`
   (`QsbAk8qw…`, slot 507402154); each upgrade was byte-verified against its build, and the
   live read API still decodes every agent.

## 1. Colosseum main track (primary submission)

| Requirement | Status |
|---|---|
| Public repo | ✅ https://github.com/thesithunyein/equxi (all commits authored by you; `LICENSE`, `SECURITY.md`, README, SPEC, TEST-RESULTS) |
| Live product | ✅ https://equxi.sithunyein.com — static HTML/JS + two dependency-free serverless routes |
| Working demo video | ❌ **lost — must re-record** |
| Submitted before Oct 12 | ⬜ you |
| Claims match the chain | ✅ upgrades live on devnet 2026-10-04 — `5tK2dMyR…` (unbonding window), `QsbAk8qw…` (top_up_bond) |

Copy for the form is already written: `COLOSSEUM-SUBMISSION.md` §1–§9, including the
honest "what is not done" section.

## 2. CertiK Security Track — answers mapped to their questions

| Their ask | Equxi answer |
|---|---|
| Colosseum submission link + public repo (or access instructions) | ⬜ Colosseum link once submitted. Repo is **public**, so no access instructions are needed |
| Description, problem, target users | See `COLOSSEUM-SUBMISSION.md` §1–2, §4 — paste as-is: consequence (not permission) is unsolved for wallet-holding agents; users are API/MCP providers, marketplaces, agent frameworks |
| Programs/contracts to audit, approximate line count | `programs/equxi/src` — **~1,216 lines of Rust**, 15 files, Anchor 0.31.2, 11 instructions. Risk-bearing surfaces: `execute_slash`, `compensate_victim`, `withdraw_bond`, `create_vault` + `state.rs` | 
| Target mainnet launch date | **Q1 2027 if funded** — mainnet is gated on post-hackathon funding, which is precisely what this track's audit credit is for. Say it that way: the track exists to get projects to mainnet |
| 6–12 month roadmap | ✅ month-by-month in [`CERTIK-BRIEF.md`](CERTIK-BRIEF.md) §5 (Nov 2026 → Oct 2027); the five-step summary stays in §7 of `COLOSSEUM-SUBMISSION.md` |
| Team: names, roles, X/GitHub, full-time? | Sithu Nyein — solo: Anchor program, SDK, elizaOS plugin, read API, explorer, and the tests. Built alongside other work, not full-time. GitHub `thesithunyein`, X `@thesithunyein` |
| Fundraising status | Bootstrapped. A **200 USDG Superteam grant** was awarded and payout is in progress; no external round raised and none in progress |
| Scoping-call contact | Email `sithunyein.mailto@gmail.com` ✅ — their form accepts email, so Telegram is optional |

Application-ready version of all of the above, with the audit scope, trust boundaries and the
month-by-month roadmap: [`CERTIK-BRIEF.md`](CERTIK-BRIEF.md).

**Where Equxi is strong for this track:** it is the one track that rewards exactly what is
already in the repo — a testnet-ready program handling on-chain value, CI that compiles and
tests it on every push, a documented migration, and a written security posture that
publishes its own defects (`reconciliation` in the API, the exit race closed, the escrow
finding stated with its fix). CertiK's criteria ("how feature-complete or testnet-ready",
"codebase quality", "willingness to show security as a foundation") map to evidence, not
promises.

**Where it is weak:** value at risk today is small and honestly so — 1.4 SOL bonded across
6 devnet agents, and the protocol deliberately holds *only operator collateral*. Say that;
do not inflate it.

## 3. Meteora DBC Track

Their note: read access (GitHub ID) is required **only for closed-source projects**. Equxi
is public, so **nothing needs to be granted** — verified: GitHub refuses to record a
read-only collaborator on a public repo (422 "Cannot assign … permission of read", same
error for your own username), and a query-param call that silently created a *write* invite
was deleted. If Meteora's own checklist still wants a name recorded, drive it from the
GitHub UI yourself and choose an explicit permission.

| Requirement | Status |
|---|---|
| Meaningful use of DBC / DAMM v2 | ✅ **working devnet integration, every step on chain** — `meteora-launch/` builds the DBC config (creator trading fee 50%, migration fee 10% with 50% to the creator), creates the pool with metadata, swaps through the curve with a partial fill that stops exactly at the graduation boundary, migrates the pool to **DAMM v2**, claims the graduation proceeds, and posts them as an Equxi agent's bond. Ten transactions, all linked in `meteora-launch/README.md` |
| Novel launch mechanics (their "Ideas we'd love to see") | ✅ "launch with safety escrow": the token launched on DBC (`EAGT`) created an agent whose bond is read back as **A / 92** by Equxi's public API. A launchpad built on this would make a token's graduation fund the collateral that backstops its own agent |
| Traction/volume | not required ("we prefer"); honest numbers on devnet: graduation threshold **0.698 SOL**, proceeds **0.0698 SOL**, bond **0.1 SOL** |
| What remains for this track | ✅ a launch page (`launch.html`, nav-linked) renders the ten transactions and the live read-back; ✅ `top_up_bond` is live on devnet so *later* deposits are recorded rather than merely held; ⬜ mainnet (Meteora's migration keepers only run there) |

**What the build already proves** (and what it does not — the README states both): the
integration is real DBC, not a mock. Two findings came out of running it rather than
reading the docs: a buy that would cross the graduation threshold must be a **partial
fill**, and a pool's **trading fees must be claimed before graduation**, because
`migrate_to_damm_v2` takes the fee vaults with it (this run left 0.0056 SOL unclaimable and
says so). The bond is Equxi's 0.1 SOL minimum: 0.0698 SOL from the launch plus a disclosed
0.0302 top-up — a larger curve removes the top-up, the mechanism is identical.

## 4. Adevar Labs Pre-Audit ($4,000 in-kind)

| Requirement | Status |
|---|---|
| Submitted to Colosseum | ⬜ (blocker #2) |
| Solana/Rust submission | ✅ Rust/Anchor program, 1,216 production lines + 167 inline test lines |
| Apply through the Superteam Earn bounty | ⬜ you — paste-ready answers in [`ADEVAR-APPLICATION.md`](ADEVAR-APPLICATION.md) |
| Answer their short questions on complexity/architecture | ✅ material ready: `SPEC.md` (AAS-1 invariants), `TEST-RESULTS.md`, the exit-race fix, the migration, 172 tests |
| **Tweet about the application + follow @AdevarLabs** | ✅ account exists — `@thesithunyein`. Still **required**: post the copy below and follow @AdevarLabs, or the application is not eligible |

Suggested tweet (their template, repo link filled in):

> Just submitted Equxi to the @AdevarLabs Security Sidetrack on @superteamearn for
> @Colosseum's Crypto World's Fair Hackathon — a Slashable-collateral trust layer for AI
> agents on Solana. Excited for the chance to receive a full security Pre-Audit for our
> project. https://github.com/thesithunyein/equxi

Their judging is codebase complexity + architectural clarity + repo completeness +
ecosystem impact — all four are already evidenced (9-instruction program with a PDA
migration executed against live state, 5 green CI jobs, LICENSE, SECURITY.md, SPEC).

## 5. Panta API Track ($5,000 pool) — needs to be built

| Requirement | Status |
|---|---|
| Submit to Colosseum + Panta sidetrack | ⬜ |
| **Meaningfully integrate the Panta API** | ✅ `GET /api/markets` built 2026-10-04 — dependency-free, 6 unit tests, all three states (unconfigured / accepted / rejected key) verified against the live Panta API; switches on when `PANTA_API_KEY` is set |
| Working demonstration of the product | ⚠️ demo video must be re-recorded anyway |

Facts verified from `docs.panta.market` (2026-10-04), so the build plan below is against
their real API:

- Base URL `https://live-api.panta.market/api/v1`; trailing slashes required.
- Auth: `X-Api-Key: pk_test_…` (register → mint a key) or `Authorization: Bearer`.
- The API **never custodies keys**: it quotes, returns unsigned Solana transactions, you
  broadcast and report the signature.
- Markets are USDC-denominated (create-market fee quoted in base units, e.g. `"50000000"` = 50 USDC);
  primary buys take human-readable decimal strings; positions, claim eligibility, win
  claims, creator fees and trade attribution all have endpoints.

**The integration that fits the product**: a market per agent — *"will this agent be
slashed before <date>?"* — surfaced where the risk is read. `/api/markets?agent=<pda>`
(dependency-free, same style as `/api/trust` and `/api/badge`) discovers existing markets,
and the Explorer's agent panel gains a market card with price + claim eligibility. Tier 2
(needs USDC + wallet flow): create a market for an agent and trade YES/NO in it. This is
also the most original angle available to us — nobody else can pair a prediction market
with verifiable on-chain collateral history, and the payoff for the main track is that the
trust data becomes *priced*.

**Built 2026-10-04.** `GET /api/markets` reads
`https://live-api.panta.market/api/v1/markets/` with `X-Api-Key`, forwards
`category | status | createdBy | cursor | limit` (limit clamped to Panta's 50), normalizes
markets into a flat list, caches for 30s, and maps Panta's error codes onto honest statuses
(`RATE_LIMITED` → 429, `INVALID_MARKET_PARAMS` → 400, rejected key → 502). With no key set
it answers `200 { configured: false, note: … }` — never a fake-empty list, never a 500 that
reads like an outage — so the endpoint is demoable before the key lands. **Still open:** the
Explorer market card, and the tier-2 market-per-agent creation flow.

Needs from you: a Panta API key (start with `pk_test_`), and a USDC wallet if we want to
create a market for the demo.

## 6. RPC Fast Sidetrack (~$10,500 in RPC infrastructure credits)

| Requirement | Status |
|---|---|
| Submit to Colosseum + RPC Fast sidetrack | ⬜ |
| Claim the Focus plan via their form | ⬜ you |
| **Use RPC Fast infrastructure during and after the hackathon** | ⚠️ wired, one env var away: the read layer now honours `EQUXI_RPC` as the deployment-wide default (`?rpc=` still wins), so switching to their endpoint is a config change, not a rewrite — endpoint URL pending from their form |
| Follow @rpcfast; join Telegram + Discord | ⬜ you |
| Publish 2–3 posts/month about RPC Fast for two months | ⬜ you (their "community presence" criterion) |

Two constraints to be honest about: their endpoints are **mainnet-only** and hosted in
Frankfurt, while Equxi's deployment is devnet-only. So the truthful claim is: the read API
is cluster-agnostic and already parameterised by RPC endpoint; pointing it at RPC Fast is
what the live site will do for mainnet reads after launch, and it can be demonstrated now.
**Do not say "Next.js dashboard"** — there is no Next.js anywhere in this repo (no
`next.config`, zero dependencies in the root `package.json`); it is static HTML/JS plus two
dependency-free serverless functions. Say "static site + dependency-free serverless read
API, RPC-endpoint parameterised".

## 7. Ordered actions to Oct 12

| # | Action | Owner | Why now |
|---|---|---|---|
| 1 | Re-record the 75s demo — terminal drivers (`prove-compensation.js` 13/13, `prove-unbonding.js` 7/7) are rehearsed and the runbook exists | you | every track needs the video; only the recording itself is left |
| 2 | ~~Deploy the CI-built program to devnet~~ **Done 2026-10-04** — unbonding window + `top_up_bond` live, byte-verified | me | the site and the chain now agree |
| 3 | Submit on Colosseum (main track) | you | unlocks CertiK / Panta / RPC Fast / Adevar |
| 4 | CertiK form (answers ready in §2) + Meteora form | you | forms are on Colosseum |
| 5 | Adevar: apply on Superteam Earn, post the tweet from `@thesithunyein`, follow @AdevarLabs | you | the tweet is a hard requirement, not a bonus |
| 6 | Panta: set `PANTA_API_KEY` (mint a `pk_test_` key) — `/api/markets` is built, tested and verified in unconfigured + rejected-key states; Explorer card remains | you (key) + me (card) | integration no longer missing: only the key |
| 7 | RPC Fast: claim Focus plan → point the read layer at their endpoint → record the proof; follow + join + 2 posts | you + me | needs their endpoint URL, which comes from the form |

## 8. What I can build next, by payoff

1. **Panta market panel** (`/api/markets` done; Explorer card remains) — converts the weakest track into
   a real integration and gives the demo a second act.
2. **Deploy the unbonding window** — removes the one place where the live site contradicts
   the live program.
3. **Meteora DBC safety-escrow launch script** — turns the Meteora pitch into code with tx
   signatures, which is what that track actually judges.
4. **Re-record the demo** — the only item that no amount of code can substitute for.
