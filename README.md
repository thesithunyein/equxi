<p align="center">
  <img src="assets/logo.webp" alt="Equxi Logo" width="100" />
</p>

<h1 align="center">Equxi</h1>

<p align="center"><strong>Solana-Native Trust Layer for AI Agents</strong></p>

<p align="center">
  <a href="https://equxi.sithunyein.com"><img src="https://img.shields.io/badge/Live-Site-9945FF?style=for-the-badge" alt="Live Site" /></a>
  <a href="https://github.com/thesithunyein/equxi/actions"><img src="https://img.shields.io/github/actions/workflow/status/thesithunyein/equxi/ci.yml?style=for-the-badge" alt="CI" /></a>
  <a href="https://superteam.fun/earn/grants/agentic-engineering"><img src="https://img.shields.io/badge/Grant-Agentic%20Engineering-22c55e?style=for-the-badge" alt="Grant" /></a>
  <a href="https://explorer.solana.com/address/9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ?cluster=devnet"><img src="https://img.shields.io/badge/Program-Devnet-22c55e?style=for-the-badge" alt="Program" /></a>
</p>

---

## The Problem

AI agents lack economic accountability. Nobody can safely trust an autonomous agent with real money because:

- **Counterparties refuse** to deal with agents that can lose money with no recourse
- **Traditional wallets** only hold funds — they can't enforce behavioral rules
- **No automatic compensation** when an agent misbehaves

## The Solution

Equxi makes AI agents **financially accountable** on Solana:

```
┌─────────────────────────────────────────────────────────┐
│  1. BOND     Operator locks SOL as safety deposit      │
│  2. ENFORCE  Rules (spend limits, timelocks) on-chain  │
│  3. SLASH    Bond penalized when rules are broken       │
│  4. PAY      Victim compensated from the deposit        │
└─────────────────────────────────────────────────────────┘
```

## Deployed

| Component | Details |
|-----------|---------|
| **Frontend** | [equxi.sithunyein.com](https://equxi.sithunyein.com) |
| **Dashboard** | [equxi.sithunyein.com/app.html](https://equxi.sithunyein.com/app.html) |
| **Documentation** | [equxi.sithunyein.com/docs.html](https://equxi.sithunyein.com/docs.html) |
| **Program ID** | `9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ` |
| **Network** | Solana Devnet |
| **Explorer** | [View on Explorer](https://explorer.solana.com/address/9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ?cluster=devnet) |
| **Deployment TX** | [`4wvtm6ijyocz5YP9BVtwXrmKkKagMQg2RJHqd5nj5HwyT8FBmShCFJBhVQPzx7QpH4cTH5ibyVjestucEyk3bkcw`](https://explorer.solana.com/tx/4wvtm6ijyocz5YP9BVtwXrmKkKagMQg2RJHqd5nj5HwyT8FBmShCFJBhVQPzx7QpH4cTH5ibyVjestucEyk3bkcw?cluster=devnet) |
| **GitHub** | [github.com/thesithunyein/equxi](https://github.com/thesithunyein/equxi) |

## Quick Start

### Prerequisites

```bash
# Solana CLI (v2.1+)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Rust (stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node.js (v18+)
# https://nodejs.org/
```

### One-Command Deploy

```bash
git clone https://github.com/thesithunyein/equxi.git
cd equxi
chmod +x setup.sh
./setup.sh
```

### Run Frontend Locally

```bash
npx serve .
# Open http://localhost:3000/app.html
```

## Architecture

```
equxi/
├── programs/equxi/           # Solana program (Rust/Anchor)
│   └── src/
│       ├── lib.rs            # 8 instructions
│       ├── state.rs          # Agent, Bond, Constraint, Config
│       ├── error.rs          # Error codes
│       └── instructions/     # Instruction handlers
│           ├── initialize.rs
│           ├── register_agent.rs
│           ├── create_bond.rs
│           ├── withdraw_bond.rs
│           ├── add_constraint.rs
│           ├── execute_slash.rs
│           ├── compensate_victim.rs
│           └── update_trust_score.rs
├── sdk/                      # TypeScript SDK
│   └── src/
│       └── index.ts          # EquxiClient class (9 methods)
├── tests/                    # Anchor tests
├── app.html                  # Dashboard
├── app.css                   # Dashboard styles
├── app.js                    # Dashboard logic (real Solana txs)
├── index.html                # Landing page
├── styles.css                # Landing styles
├── main.js                   # Landing animations
├── docs.html                 # Documentation
└── setup.sh                  # One-command deploy
```

## Program Instructions

| Instruction | Description | Who Can Call |
|-------------|-------------|--------------|
| `initialize` | Set up admin config authority | Deployer (once) |
| `register_agent` | Create on-chain agent identity (PDA) | Operator |
| `create_bond` | Lock SOL as collateral for agent | Operator |
| `withdraw_bond` | Withdraw bond after lock period expires | Operator |
| `add_constraint` | Add behavioral rule (spend limit, timelock, etc.) | Operator |
| `execute_slash` | Penalize bond for rule violation | Admin |
| `compensate_victim` | Transfer slashed funds to victim | Admin |
| `update_trust_score` | Update agent trust score | Admin |

## SDK Usage

```typescript
import { EquxiClient } from "@equxi/sdk";
import { AnchorProvider } from "@coral-xyz/anchor";

const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
const client = new EquxiClient(provider);

// Register an agent
const { agentPDA } = await client.registerAgent("AlphaTrader", { trader: {} });

// Lock 5 SOL for 30 days
await client.createBond(agentPDA, 5_000_000_000, 2_592_000);

// Add spending limit (max 1 SOL per day)
await client.addConstraint(agentPDA, { spendLimit: {} }, {
  maxAmount: 1_000_000_000,
  maxPerPeriod: 5_000_000_000,
  periodSeconds: 86400,
});

// Query on-chain state
const agent = await client.getAgent(agentPDA);
console.log("Trust score:", agent.trustScore);

// Withdraw after lock expires
await client.withdrawBond(bondPDA);
```

## Dashboard Features

- **Phantom Wallet** — Connect with one click, auto-reconnect
- **Register Agents** — Create on-chain agent identities
- **Lock Deposits** — Collateralize agent behavior with SOL
- **Add Rules** — Spending limits, program allowlists, timelocks, velocity limits
- **Report Violations** — Trigger automatic bond slashing
- **Explorer Links** — Every transaction linked to Solana Explorer
- **Live Balance** — Real-time SOL balance from devnet
- **Video Background** — Consistent branding across landing + dashboard

## On-Chain Accounts

### Config (Singleton)
```rust
struct Config {
    authority: Pubkey,    // Admin who can slash/compensate
    bump: u8,             // PDA bump seed
    nonce: u64,           // Global nonce counter
}
```

### Agent (PDA)
```rust
struct Agent {
    operator: Pubkey,     // Wallet that registered this agent
    name: [u8; 32],       // Agent name
    agent_type: AgentType, // Trader | Assistant | Framework | Custom
    trust_score: u16,     // 0-100 reputation
    status: AgentStatus,  // Active | Suspended | Slashed
    registered_at: i64,   // Unix timestamp
    bump: u8,
}
```

### Bond (PDA)
```rust
struct Bond {
    agent: Pubkey,        // Associated agent
    operator: Pubkey,     // Bond owner
    amount: u64,          // Locked lamports
    lock_expiry: i64,     // Unix timestamp
    created_at: i64,
    is_active: bool,
    bump: u8,
}
```

### Constraint (PDA)
```rust
struct Constraint {
    agent: Pubkey,
    constraint_type: ConstraintType, // SpendLimit | ProgramAllowlist | Timelock | Velocity
    max_amount: u64,
    max_per_period: u64,
    period_seconds: u32,
    active: bool,
    bump: u8,
}
```

## Testing

```bash
# Build the program
cargo build-sbf

# Run tests
anchor test
```

## CI/CD

GitHub Actions runs on every push:
- **Lint & Typecheck** — SDK TypeScript compilation
- **Verify Project** — File structure, program existence, frontend validation

## Grant

Built for the [Agentic Engineering Grant](https://superteam.fun/earn/grants/agentic-engineering) by Supenteam.

**Category:** Agentic Engineering

**Skills:** Frontend · Blockchain · Backend · Content

---

Built by [Sithu Nyein](https://sithunyein.com) · Generated with Codebuff
