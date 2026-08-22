<p align="center">
  <img src="assets/logo.webp" alt="Equxi Logo" width="100" />
</p>

<h1 align="center">Equxi</h1>

<p align="center"><strong>Solana-Native Trust Layer for AI Agents</strong></p>

<p align="center">
  <a href="https://equxi.sithunyein.com"><img src="https://img.shields.io/badge/Live-Site-9945FF?style=for-the-badge" alt="Live Site" /></a>
  <a href="https://github.com/thesithunyein/equxi/actions"><img src="https://img.shields.io/github/actions/workflow/status/thesithunyein/equxi/ci.yml?style=for-the-badge" alt="CI" /></a>
  <a href="https://superteam.fun/earn/grants/agentic-engineering"><img src="https://img.shields.io/badge/Grant-Agentic%20Engineering-22c55e?style=for-the-badge" alt="Grant" /></a>
  <a href="https://explorer.solana.com/address/D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc?cluster=devnet"><img src="https://img.shields.io/badge/Program-Devnet-22c55e?style=for-the-badge" alt="Program" /></a>
</p>

---

## The Problem

AI agents lack economic accountability. Nobody can safely trust an autonomous agent with real money because:

- **Counterparties refuse** to deal with agents that can lose money with no recourse
- **Traditional wallets** only hold funds — they can't enforce behavioral rules
- **No automatic compensation** when an agent misbehaves

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  1. REGISTER  Create on-chain agent identity            │
│  2. BOND      Operator locks SOL as safety deposit      │
│  3. ENFORCE   Rules (spend limits, timelocks) on-chain  │
│  4. SLASH     Bond penalized when rules are broken       │
│  5. COMPENSATE Victim receives slashed funds             │
└─────────────────────────────────────────────────────────┘
```

## Deployed

| Component | Link |
|-----------|------|
| **Landing Page** | [equxi.sithunyein.com](https://equxi.sithunyein.com) |
| **Dashboard** | [equxi.sithunyein.com/app.html](https://equxi.sithunyein.com/app.html) |
| **Documentation** | [equxi.sithunyein.com/docs.html](https://equxi.sithunyein.com/docs.html) |
| **Program** | [`D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`](https://explorer.solana.com/address/D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc?cluster=devnet) |
| **Network** | Solana Devnet |
| **Repo** | [github.com/thesithunyein/equxi](https://github.com/thesithunyein/equxi) |

## On-Chain Proof

The program executes 8 instructions on devnet. Confirmed transactions:

| Instruction | Description |
|-------------|-------------|
| `initialize` | Configures admin authority |
| `register_agent` | Creates agent identity (name, type, trust score) |
| `create_bond` | Locks SOL as collateral |
| `withdraw_bond` | Returns SOL after lock period |
| `add_constraint` | Adds behavioral rule (spend limit, timelock, etc.) |
| `execute_slash` | Penalizes bond for rule violation |
| `compensate_victim` | Transfers slashed funds to victim |
| `update_trust_score` | Updates agent reputation |

## Quick Start

### Frontend

```bash
git clone https://github.com/thesithunyein/equxi.git
cd equxi
npx serve .
# Open http://localhost:3000/app.html
```

### Program

```bash
# Prerequisites: Solana CLI v2.1+, Rust stable
git clone https://github.com/thesithunyein/equxi.git
cd equxi
cargo build-sbf
solana program deploy target/deploy/equxi.so
```

## Architecture

```
equxi/
├── programs/equxi/           # Solana program (Rust/Anchor)
│   └── src/
│       ├── lib.rs            # 8 instructions
│       ├── state.rs          # Account structs
│       ├── error.rs          # Error codes
│       └── instructions/     # Instruction handlers
├── sdk/                      # TypeScript SDK
├── app.html                  # Dashboard
├── app.js                    # Dashboard logic
├── app.css                   # Dashboard styles
├── index.html                # Landing page
├── docs.html                 # Documentation
└── styles.css                # Landing styles
```

## On-Chain Accounts

```rust
struct Config {
    admin: Pubkey,           // Admin who can slash
    total_agents: u64,
    total_bonds: u64,
    total_slashed: u64,
}

struct Agent {
    owner: Pubkey,           // Operator wallet
    name: [u8; 32],          // Agent name
    agent_type: AgentType,   // Trader, Oracle, DeFi, etc.
    trust_score: u8,         // 0-100 reputation
    status: AgentStatus,     // Active, Slashed, Deactivated
}

struct Bond {
    agent: Pubkey,           // Associated agent
    operator: Pubkey,        // Bond owner
    amount: u64,             // Locked lamports
    expires_at: i64,         // Lock expiry timestamp
    is_active: bool,
}

struct Constraint {
    agent: Pubkey,
    constraint_type: ConstraintType,  // SpendLimit, ProgramAllowlist, Timelock
    params: ConstraintParams,
    is_enforced: bool,
}
```

## SDK

```typescript
import { EquxiClient } from "./sdk/src";

const client = new EquxiClient(provider);

// Register agent
const { agentPDA } = await client.registerAgent("AlphaTrader", { trader: {} });

// Lock 5 SOL for 30 days
await client.createBond(agentPDA, 5_000_000_000, 2_592_000);

// Add spending limit (max 1 SOL per day)
await client.addConstraint(agentPDA, { spendLimit: {} }, {
  maxAmount: 1_000_000_000,
  maxPerPeriod: 5_000_000_000,
  periodSeconds: 86400,
});

// Slash for violation
await client.executeSlash(agentPDA, bondPDA, 100_000_000, "Exceeded spending limit");
```

## Built For

[Agentic Engineering Grant](https://superteam.fun/earn/grants/agentic-engineering) by Superteam.

---

Built by [Sithu Nyein](https://sithunyein.com)
