# OUTREACH-KIT.md — getting one external operator (the only lever that moves Traction)

The main-track rubric caps at ~8.6 with zero external demand. One person who is not the
founder registering an agent and bonding the 0.1 SOL devnet minimum turns Traction from
"self-operated" into "one external user, verifiable on chain" — visible to any judge in
`/api/trust` and in the Explorer. A permissioned one-line quote is the cheaper fallback if
nobody will register; both count, and neither can be faked.

**Rules for this kit:** ask for nothing you cannot honestly describe as useful to them,
never write a quote for someone else, and log any quote with the person's permission and
their name attached. Devnet SOL is worthless; saying so is fine.

---

## 1. The 5-minute path for a friendly dev

They need a Solana wallet that supports devnet (Phantom) — nothing else, no spend.

1. Open **https://equxi.sithunyein.com/app.html** and switch Phantom to **Devnet**.
2. Tell us their wallet address (or paste it in the DM) — **we send 0.5 devnet SOL** so
   they never touch a faucet. (Ask us for the send; it costs nothing.)
3. In the dashboard: **Register agent** (pick any name), then **Lock bond** with the
   **0.1 SOL** minimum.
4. Done. Their agent appears in the public registry at
   **https://equxi.sithunyein.com/explorer.html** and in
   `GET /api/trust?agent=<their agent PDA>` — as operator #1 who is not the founder.

Optional, if they want to see the consequence side: they can watch (not run) the slash
demo, or ask us to point at a recorded run. Nobody slashes their agent; the bond is
theirs and withdrawable after the window.

## 2. What they get (say this, it is true)

- Their agent listed in a public, on-chain trust registry with a real bond behind it —
  and a badge any README can wear: `/api/badge?agent=<pda>`.
- A say in what the registry reports next: the read API and badge are already public,
  and their feedback goes into the next commit like every other defect has.
- Credit if they want it: the README's operator list, or the launch/docs page.
- Their 0.1 SOL back (devnet) whenever they want, after the unbonding window — the
  program is not custodial.

## 3. Direct message (short, one person)

> Hey — I built Equxi, slashable collateral for AI agents on Solana (bond → escrow →
> victim, no custodian). It's on devnet and I'm looking for the **first operator who
> isn't me** to register an agent and lock the 0.1 SOL minimum. It takes ~5 minutes:
> I'll send you the devnet SOL, you click register + bond in the dashboard, and your
> agent shows up in the public registry. Zero cost, nothing to install. Want me to hand
> you the SOL right now? — https://equxi.sithunyein.com

## 4. Community post (Superteam / Solana / elizaOS discords)

> **First external operator for a devnet trust layer — 5 minutes, no cost.**
> Equxi bonds agents with slashable SOL on devnet: a violation moves money from the bond
> into an escrow vault and out to the victim, all on chain (11 instructions, 181 tests,
> live read API: equxi.sithunyein.com/api/trust). I need the registry to contain one
> operator that isn't the builder — register an agent and lock the 0.1 SOL devnet
> minimum, and I'll send you the SOL first so it costs nothing. You keep the bond, you
> can withdraw it after the window, and I'll credit you in the repo if you want.
> Reply here or DM me and I'll hand over the SOL.

## 5. The quote fallback (if nobody will register)

Ask one person who ships agents or runs a marketplace/API — the honest ask:

> If this were live on mainnet, I'd want one sentence from you on whether you'd use it,
> good or bad. Can I quote you by name, or would you rather I keep it anonymous?

A usable quote sounds like: *"Before I let an unknown agent call our API, I'd want to see
that something gets taken from it if it misbehaves."* — logged as a name + date in
your own outreach log. Do not smooth it into marketing language; the credibility is in
it being theirs.

## 6. Where to send it, in order of yield

1. People already in the repo's orbit: anyone who starred, forked, or asked about it.
2. Superteam (the grant's community) and the elizaOS / MCP builder discords.
3. A marketplace or framework maintainer — ask for the quote even if registration is too
   much; their name is worth as much as the bond.
4. Public replies on the pitch video once it is posted — one DM to anyone who engages.

Ten sends is the whole campaign. One yes is the difference the rubric measures.
