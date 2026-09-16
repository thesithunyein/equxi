<p align="center">
  <img src="assets/logo.webp" alt="Equxi Logo" width="100" />
</p>

<h1 align="center">Equxi</h1>

<p align="center"><strong>Slashable collateral for AI agents on Solana</strong></p>

<p align="center">
  <a href="https://equxi.sithunyein.com"><img src="https://img.shields.io/badge/Live-Site-9945FF?style=for-the-badge" alt="Live Site" /></a>
  <a href="https://github.com/thesithunyein/equxi/actions"><img src="https://img.shields.io/github/actions/workflow/status/thesithunyein/equxi/ci.yml?style=for-the-badge" alt="CI" /></a>
  <a href="https://superteam.fun/earn/grants/agentic-engineering"><img src="https://img.shields.io/badge/Grant-Agentic%20Engineering-22c55e?style=for-the-badge" alt="Grant" /></a>
  <a href="https://explorer.solana.com/address/D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc?cluster=devnet"><img src="https://img.shields.io/badge/Program-Devnet-22c55e?style=for-the-badge" alt="Program" /></a>
</p>

---

## The Problem

Agents are being handed money. Nobody can check them.

The rails already exist — agents have wallets, cards, bank accounts and paid API access.
What none of it answers is what happens when an agent takes the payment and doesn't deliver:

- **The provider eats the loss.** An API or MCP endpoint serving an unknown agent spends
  compute and credits before settlement clears. If the agent never pays, there is no recourse.
- **A reputation with nothing behind it is free to lie.** An agent can burn a rating,
  re-register under a new key, and be back to a clean slate the same block.
- **Permission is solved; consequence isn't.** Wallets cap what an agent can spend. Nothing
  makes it *pay* when it breaks a rule anyway.

Platforms have solved **permission** — allowlists, spend caps, approval prompts.
Equxi supplies the missing half: **consequence**.

An operator registers an agent and locks SOL as a bond. The program holds it in its own
vault. Rules run on-chain, and any counterparty — an API provider, a marketplace, another
agent — reads the bond and slash history from one endpoint before deciding whether to deal.

### Who reads a bond

| Buyer | What they get |
|---|---|
| **API & MCP providers** | A way to price the risk of serving an unknown agent before spending compute on it |
| **Agent marketplaces** | Bonding as a listing requirement, which moves liability onto the operator |
| **Agent frameworks** | A trust module their wallet-holding agents can adopt instead of building compliance |

## How It Works

<p align="center">
  <strong>1. Register</strong> &nbsp;&rarr;&nbsp; <strong>2. Bond</strong> &nbsp;&rarr;&nbsp; <strong>3. Enforce</strong> &nbsp;&rarr;&nbsp; <strong>4. Slash</strong> &nbsp;&rarr;&nbsp; <strong>5. Compensate</strong>
</p>

<p align="center">
  <em>Create identity</em> &nbsp;&middot;&nbsp; <em>Lock SOL</em> &nbsp;&middot;&nbsp; <em>Set rules</em> &nbsp;&middot;&nbsp; <em>Penalize</em> &nbsp;&middot;&nbsp; <em>Pay victims</em>
</p>

## Deployed

| Component | Link |
|-----------|------|
| Landing Page | [equxi.sithunyein.com](https://equxi.sithunyein.com) |
| Dashboard | [equxi.sithunyein.com/app.html](https://equxi.sithunyein.com/app.html) |
| Documentation | [equxi.sithunyein.com/docs.html](https://equxi.sithunyein.com/docs.html) |
| Program | [`D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`](https://explorer.solana.com/address/D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc?cluster=devnet) |
| Network | Solana Devnet |
| Repo | [github.com/thesithunyein/equxi](https://github.com/thesithunyein/equxi) |

## On-Chain Proof

The program executes 8 instructions on devnet. All transactions confirmed.

| Instruction | Description |
|-------------|-------------|
| `initialize` | Creates config + escrow vault; admin is bound to the program upgrade authority |
| `register_agent` | Creates agent identity with name, type, and trust score |
| `create_bond` | Locks SOL as collateral — the agent owner must sign |
| `withdraw_bond` | Returns and closes the bond after the lock period |
| `add_constraint` | Adds a behavioral rule; agents may hold many |
| `execute_slash` | Seizes collateral into the program-owned escrow vault |
| `compensate_victim` | Pays the victim out of the escrow vault |
| `update_trust_score` | Updates agent reputation |
| `migrate_agent` | Grows a v0.1 agent account in place, preserving every existing field |

## Quick Start

### Frontend

```bash
git clone https://github.com/thesithunyein/equxi.git
cd equxi

# Serves the site AND the api/ functions locally (no Vercel CLI, no build step).
node dev-server.js

#   Dashboard    http://localhost:4321/app.html
#   Explorer     http://localhost:4321/explorer.html
#   Read API     http://localhost:4321/api/trust
#   Badge        http://localhost:4321/api/badge?agent=<pda>
```

Plain `npx serve .` also works for the dashboard, but the Trust Explorer needs
`/api/trust` and `/api/badge`, which `dev-server.js` provides and a static server
does not.

### Program

```bash
# Prerequisites: Solana CLI v2.1+, Rust stable
git clone https://github.com/thesithunyein/equxi.git
cd equxi
cargo build-sbf
solana program deploy target/deploy/equxi.so
```

### Upgrading a live deployment

Shipping new program code is only half an upgrade, and the other half is the
part that bites. v0.2 added `constraint_count` to `Agent`, growing that account
from 116 to 118 bytes. Anchor refuses to deserialize a shorter account, so once
the new code is deployed the program cannot read its own pre-existing agents —
and nothing looks wrong from outside, because the website decodes accounts
directly and keeps working.

```bash
node migrate.js --dry-run   # report what would change; sends nothing
bash deploy-v2.sh           # upgrade, migrate, create the vault, verify
```

`deploy-v2.sh` refuses to start unless three things hold: the on-chain program
still matches the v0.1 build kept for rollback, the artifact declares *this*
deployment's program id (an `anchor build` run after `anchor keys sync`
produces one that would deploy cleanly and then reject every instruction), and
the authority holds the rent the upgrade buffer needs.

`migrate.js` creates the escrow vault that v0.1 never had, grows every agent
still on the v0.1 layout, and then re-decodes each account to prove that owner,
name, score, status, bond address and `created_at` are byte-for-byte unchanged.
A migration that quietly rewrote a reputation record would be worse than no
migration at all, so it checks rather than assumes.

### Tests

```bash
npm install

# Wire formats, PDA seeds, IDL, SDK, read layer and read API. No validator, no
# Solana toolchain, no network. About a second. This is the fast gate.
npm run test:unit

# The full program suite against a local validator (needs Anchor + Solana CLI).
anchor test
```

`tests/unit/` is the contract for the account layouts in `SPEC.md`. It builds
account buffers by hand, decodes them with the hand-written decoders, the read
API's decoders, and Anchor's own coder, and asserts all of them agree — so a
layout change that is not mirrored in every client fails immediately.

| File | What it pins |
|------|--------------|
| `tests/unit/layout.test.ts` | Discriminators, PDAs, Borsh encoding |
| `tests/unit/sdk.test.ts` | The IDL shipped in `sdk/src/idl/equxi.json` |
| `tests/unit/read.test.ts` | Query filters, decoding, the trust-scoring rules, and that the SDK scorer and the API scorer agree |
| `tests/unit/api.test.ts` | `api/trust.js` and `api/badge.js` end to end, against a stubbed RPC |

> **Honest status:** the unit tests and all TypeScript typechecks pass, CI
> compiles the Rust program and runs `anchor test` on a local validator, and the
> 116 → 118 byte agent migration has its own Rust unit tests. **Devnet runs v0.2
> as of 2026-09-16**, with the live agent migrated in place (all 8 preserved
> fields verified byte-identical) and the escrow vault created — transactions in
> [`TEST-RESULTS.md`](TEST-RESULTS.md).

## Architecture

```
equxi/
├── programs/equxi/           Solana program (Rust/Anchor)
│   └── src/
│       ├── lib.rs            9 instructions (8 on devnet: create_vault is v0.2)
│       ├── state.rs          Account structs
│       ├── error.rs          Error codes
│       └── instructions/     Instruction handlers
├── sdk/                      TypeScript SDK (src/idl/equxi.json is the IDL)
│   └── src/read.ts           Query layer: list agents, bonds, slash history
├── eliza-plugin/             elizaOS plugin (IDL-free; encodes from coder.ts)
├── api/trust.js              GET /api/trust — public read API (Vercel function)
├── api/badge.js              GET /api/badge — embeddable SVG trust badge
├── lib/equxi-layout.js       Account layouts + scoring for the API (no deps)
├── dev-server.js             Static server + read API for local development
├── tests/unit/               Validator-free wire-format + SDK + read tests
├── SPEC.md                   Agent Accountability Standard (AAS-1)
├── explorer.html             Trust Explorer (public, read-only)
├── explorer.js               Explorer logic
├── app.html                  Dashboard
├── app.js                    Dashboard logic
├── app.css                   Dashboard styles
├── index.html                Landing page
├── docs.html                 Documentation
└── styles.css                Landing styles
```

## On-Chain Accounts

```rust
struct Config {
    admin: Pubkey,           // Slash/compensate authority (= program upgrade authority)
    total_agents: u64,
    total_bonds: u64,
    total_slashed: u64,      // also the slash-record nonce source
}

struct Vault {               // Program-owned escrow for slashed collateral
    total_slashed: u64,
    total_compensated: u64,
}

struct Agent {
    owner: Pubkey,           // Operator wallet — must sign to create a bond
    name: [u8; 32],
    agent_type: AgentType,   // Trader, Oracle, DeFi, etc.
    trust_score: u8,         // 0-100 reputation
    status: AgentStatus,     // Active, Slashed, Deactivated
    bond_address: Pubkey,
    constraint_count: u16,   // next constraint PDA index
    created_at: i64,
}

struct Bond {
    agent: Pubkey,
    operator: Pubkey,        // always the agent owner
    amount: u64,             // collateral still held (excludes rent)
    lock_duration: i64,
    locked_at: i64,
    expires_at: i64,
    is_active: bool,
}

struct Constraint {
    agent: Pubkey,
    constraint_type: ConstraintType,  // SpendLimit, ProgramAllowlist, Timelock, Velocity
    params: ConstraintParams,
    is_enforced: bool,
    created_at: i64,
}

struct SlashRecord {
    agent: Pubkey,
    authority: Pubkey,
    amount: u64,
    reason: [u8; 128],
    nonce: u64,
    timestamp: i64,
    victim: Option<Pubkey>,
    compensated: bool,
}
```

## Security Model

Equxi is **non-custodial with respect to slashed funds**:

- **Slashed collateral is escrowed, never taken.** `execute_slash` moves lamports
  from the bond into a program-owned `vault` PDA. The admin never receives them.
- **Compensation is paid from escrow.** `compensate_victim` transfers from the vault
  to the victim and does **not** touch `bond.amount`, so a bond's recorded collateral
  always matches the lamports it actually holds. The vault maintains
  `lamports == rent_exempt_min + (total_slashed - total_compensated)`.
- **Withdrawal closes the bond.** `close = operator` returns rent plus remaining
  collateral, so nothing is stranded in an unreachable account.
- **Only the owner can bond.** `create_bond` requires the agent owner's signature,
  so a third party cannot squat an agent's bond PDA.
- **The admin is the upgrade authority.** `initialize` takes no admin argument and
  verifies the signer against the program's `ProgramData` upgrade authority.
- **Compensation is bounded.** A payout cannot exceed its slash amount, a slash can
  only be compensated once, and payouts cannot exceed the vault balance.

> **Scope note.** Equxi does not yet *prevent* violations on chain — detection is
> off-chain and a slash is asserted by the configured authority. The protocol
> guarantees that once a violation is recorded, the money moves correctly. On-chain
> violation proofs, dispute windows, and decentralized slashing are tracked as open
> problems in [`SPEC.md`](SPEC.md).

## Read API

The question a counterparty actually asks is not "how does the program work" but
*does this agent have collateral at risk, and has it ever been slashed?*
`GET /api/trust` answers it as JSON. It is a single dependency-free Vercel
function ([`api/trust.js`](api/trust.js)) over
[`lib/equxi-layout.js`](lib/equxi-layout.js).

```bash
# Every agent, with bond and slash history joined
curl https://equxi.sithunyein.com/api/trust

# One agent by its PDA address
curl "https://equxi.sithunyein.com/api/trust?agent=<pda>"

# Every agent owned by a wallet
curl "https://equxi.sithunyein.com/api/trust?owner=<wallet>"
```

```jsonc
{
  "ok": true,
  "cluster": "devnet",
  "warnings": [],
  "counts": { "agents": 12, "bonds": 9, "slashes": 3, "constraints": 21 },
  "totals": { "slashCount": 3, "openSlashes": 1, "bondedLamports": "…", "bondedSol": 41.5 },
  "vault": { "totalSlashedLamports": "…", "availableLamports": "…" },
  "agents": [
    {
      "address": "…", "name": "augur", "owner": "…", "status": "active", "layout": "v2",
      "profile": {
        "grade": "B", "score": 80, "onChainTrustScore": 50,
        "breakdown": [
          { "label": "Base score", "points": 100 },
          { "label": "1 slash recorded (10 each)", "points": -10 },
          { "label": "1 slash not yet compensated (12 each)", "points": -12 }
        ],
        "bond": { "amountSol": 3, "locked": true, "expired": false },
        "slashes": [{ "reason": "exceeded spend limit", "compensated": false }],
        "stats": { "slashCount": 1, "openSlashes": 1, "uncompensatedLamports": "…" },
        "warnings": ["On-chain trust_score is 50; the derived score is 80. …"]
      }
    }
  ]
}
```

**The score is derived, not read.** `grade` and `score` come only from
observable on-chain evidence — whether a bond is posted, how large it is, and
whether each recorded violation was actually compensated. The on-chain
`trust_score` field is admin-set, so it is reported separately and never used as
an input. An agent with no bond is `ungraded`, not trustworthy.

**The score is auditable, not asserted.** `profile.breakdown` is the ledger that
produced the score: a `+100` base entry followed by one negative entry per
deduction, summing exactly to `score` (including the floor, which is recorded as
its own entry so the arithmetic still closes). A counterparty can therefore check
the number instead of trusting it, and `tests/unit/read.test.ts` pins the
invariant.

## Embeddable trust badge

The registry is only useful where agents are already shown, so any agent can wear
its own grade:

```bash
curl "https://equxi.sithunyein.com/api/badge?agent=<pda>"                 # SVG
curl "https://equxi.sithunyein.com/api/badge?agent=<pda>&format=json"    # numbers
```

```markdown
[![Equxi trust](https://equxi.sithunyein.com/api/badge?agent=<pda>)](https://equxi.sithunyein.com/explorer.html?agent=<pda>)
```

The badge re-reads the chain on **every** request, so it cannot silently go
stale, and it refuses to flatter: an address with no agent account renders grey
`not found`, not green, and `x-equxi-status: unknown` says so in the headers. It
is a live view, not a certificate. Agent names and slash reasons are
attacker-controlled, so everything is XML-escaped before it reaches the markup.

**Which layout it read is part of the response.** Devnet runs v0.2, whose
`Agent` accounts are 118 bytes and whose slashed collateral is held in an escrow
`vault` — but the reader still understands the 116-byte v0.1 layout, because a
pre-migration agent on any deployment must stay readable. The decoder selects the
layout from the account length and reports `layout: "v1" | "v2"`, adding a
program-level `warnings` entry when a deployment is v0.1, so a reader can see
whether the numbers are partial instead of assuming they are complete.

`api/trust.js` is the only JavaScript that restates the account layouts besides
the TypeScript clients, and the duplication is deliberate: the site is static and
`vercel.json` sets `"buildCommand": null`, so there is nowhere to run generated
code. What keeps the copy honest is
[`tests/unit/api.test.ts`](tests/unit/api.test.ts), which pins every
discriminator, size, and decoded field against the independently written decoder
in `eliza-plugin/src/coder.ts`.

## Trust Explorer

[`explorer.html`](explorer.html) is the human-readable view of the same data —
the page you can hand to someone who will not run `curl`. It is read-only and has
no wallet connection.

It answers the question a counterparty has, not the one a developer has:

* **Search the way people know an agent** — by name, by agent address, or by the
  owner wallet that controls it. A pubkey is tried as an agent account first and
  then as an owner, so the reader does not have to know which they pasted.
* **Sort and filter the registry** by collateral, weakest score, slash count or
  age, and narrow by grade or to agents with unpaid slashes.
* **Audit the grade.** Each agent's panel renders the score ledger
  (`profile.breakdown`) so the deduction behind every point is visible, next to
  the on-chain `trust_score` it deliberately ignores.
* **Count rules the honest way.** The on-chain constraint *counter* does not exist
  on v0.1 accounts, so rule counts are read from the Constraint accounts
  themselves and labelled `found (counter n/a)` — never a confident `0` that
  contradicts the rules listed beside it.
* **Embed it.** Every agent panel generates the Markdown, HTML and JSON URLs for
  that agent's live badge.

Deep links work for all three lookups: `?agent=<pda>`, `?owner=<wallet>` and
`?q=<name>`. A failed lookup is reported as a failure — the page never presents an
RPC error as “no agents found”.

## SDK

The Anchor IDL lives at [`sdk/src/idl/equxi.json`](sdk/src/idl/equxi.json) and is
loaded by `EquxiClient`. It is checked in because the SDK must install and work
without an `anchor build` step. `anchor build` regenerates an equivalent file at
`target/idl/equxi.json`; copy that over to refresh it. `tests/unit/sdk.test.ts`
fails if the IDL drifts from the code.

```typescript
import { EquxiClient } from "./sdk/src";

const client = new EquxiClient(provider);

// One-time. Must be signed by the program's upgrade authority.
await client.initialize();

// Register agent
const { agentPDA } = await client.registerAgent("AlphaTrader", { trader: {} });

// Lock 5 SOL for 30 days. The agent owner signs.
const { bondPDA } = await client.createBond(
  agentPDA, new BN(5_000_000_000), new BN(2_592_000)
);

// Add a spending limit (max 1 SOL per day). Agents may hold many rules.
await client.addConstraint(agentPDA, { spendLimit: {} }, {
  maxAmount: new BN(1_000_000_000),
  maxPerPeriod: new BN(5_000_000_000),
  periodSeconds: new BN(86400),
  timelockSeconds: new BN(0),
  allowedPrograms: Array(8).fill(SystemProgram.programId),
});

// A violation is recorded: seize collateral into escrow
const { slashPDA } = await client.executeSlash(
  agentPDA, "Exceeded spending limit", new BN(100_000_000)
);

// Pay the injured party out of escrow
await client.compensateVictim(agentPDA, new BN(0), victimPubkey, new BN(100_000_000));

// Anyone can audit the escrow
const vault = await client.getVault();
console.log("Available to victims:", vault.available.toString());
```

## Usage in elizaOS

**pnpm, straight from git today:**

```bash
pnpm add github:thesithunyein/equxi#path:eliza-plugin
```

**npm / yarn:** clone and install by path (npm's git installer cannot target a subdirectory):

```bash
git clone https://github.com/thesithunyein/equxi.git
# then in your package.json:
#   "dependencies": { "@equxi/plugin-eliza": "file:../equxi/eliza-plugin" }
```

Once published, this becomes `npm install @equxi/plugin-eliza`.

```typescript
import { equxiPlugin } from "@equxi/plugin-eliza";

const agent = {
  plugins: [equxiPlugin],
  settings: {
    WALLET_PUBLIC_KEY: "your-solana-wallet-public-key",
    SOLANA_RPC_URL: "https://api.devnet.solana.com",
  },
};
```

Then talk to your agent naturally:

| What you say | Action triggered |
|---|---|
| `"Register my bot as an agent"` | `EQUXI_REGISTER_AGENT` |
| `"Lock 0.5 SOL as bond"` | `EQUXI_LOCK_BOND` |
| `"Set 1 SOL daily spend limit"` | `EQUXI_ADD_CONSTRAINT` |
| `"Slash 0.1 SOL for exceeding limit"` | `EQUXI_SLASH_BOND` |

See [`eliza-plugin/README.md`](eliza-plugin/README.md) for full docs.

## Built For

[Agentic Engineering Grant](https://superteam.fun/earn/grants/agentic-engineering) by Superteam.

---

Built by [Sithu Nyein](https://sithunyein.com)
