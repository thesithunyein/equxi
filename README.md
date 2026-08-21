<p align="center">
  <img src="assets/logo.webp" alt="Equxi Logo" width="100" />
</p>

<h1 align="center">Equxi</h1>

<p align="center"><strong>Solana-Native Trust Layer for AI Agents</strong></p>

<p align="center">
  <a href="https://equxi.sithunyein.com"><img src="https://img.shields.io/badge/Live-Site-9945FF?style=for-the-badge" alt="Live Site" /></a>
  <a href="https://github.com/thesithunyein/equxi/actions"><img src="https://img.shields.io/github/actions/workflow/status/thesithunyein/equxi/ci.yml?style=for-the-badge" alt="CI" /></a>
  <a href="https://superteam.fun/earn/grants/agentic-engineering"><img src="https://img.shields.io/badge/Grant-Agentic%20Engineering-22c55e?style=for-the-badge" alt="Grant" /></a>
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

## Quick Start

### Prerequisites

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1

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

This will:
1. Configure Solana for devnet
2. Generate keypairs
3. Build the program
4. Run tests
5. Deploy to devnet
6. Print the program ID

### Manual Deploy

```bash
solana config set --url devnet
anchor build
anchor deploy --provider.cluster devnet
```

### Run Frontend

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
│       ├── state.rs          # Agent, Bond, Constraint, SlashRecord, Config
│       ├── error.rs          # 12 error codes
│       └── instructions/     # All instruction handlers
├── sdk/                      # TypeScript SDK
│   └── src/
│       └── index.ts          # EquxiClient class (9 methods)
├── tests/                    # Anchor tests (5 cases)
├── app.html                  # Dashboard
├── app.css                   # Dashboard styles
├── app.js                    # Dashboard logic (real Solana txs)
├── index.html                # Landing page
├── styles.css                # Landing styles
├── main.js                   # Landing animations
└── setup.sh                  # One-command deploy
```

## Program Instructions

| Instruction | Description | Who Can Call |
|-------------|-------------|--------------|
| `initialize` | Set up admin authority | Anyone (once) |
| `register_agent` | Create agent identity | Operator |
| `create_bond` | Lock SOL as collateral | Operator |
| `withdraw_bond` | Return funds after lock expires | Operator |
| `add_constraint` | Deploy behavioral rule | Operator |
| `execute_slash` | Penalize bond for violation | Admin |
| `compensate_victim` | Pay victim from slashed funds | Admin |
| `update_trust_score` | Update agent reputation | Admin |

## SDK Usage

```typescript
import { EquxiClient } from "@equxi/sdk";
import { AnchorProvider } from "@coral-xyz/anchor";

const provider = new AnchorProvider(connection, wallet, {});
const client = new EquxiClient(provider);

// Register an agent
const { agentPDA } = await client.registerAgent("AlphaTrader", { trader: {} });

// Lock 5 SOL for 30 days
await client.createBond(agentPDA, new BN(5_000_000_000), new BN(2592000));

// Add spending limit (max 500 SOL per tx)
await client.addConstraint(agentPDA, { spendLimit: {} }, {
  maxAmount: new BN(500_000_000_000),
  maxPerPeriod: new BN(0),
  periodSeconds: new BN(0),
  timelockSeconds: new BN(0),
  allowedPrograms: Array(8).fill(PublicKey.default),
});

// Withdraw after lock expires
await client.withdrawBond(agentPDA);
```

## Dashboard Features

- **Phantom Wallet** — Connect with one click
- **Register Agents** — Create on-chain agent identities
- **Lock Deposits** — Collateralize agent behavior
- **Add Rules** — Spending limits, program allowlists, timelocks
- **Report Violations** — Trigger automatic compensation
- **Explorer Links** — Every transaction linked to Solana Explorer
- **Live Balance** — Real-time SOL balance from devnet

## Testing

```bash
# Run all tests
anchor test

# Run specific test
anchor test --grep "Registers an agent"
```

## Deployed

| Component | URL |
|-----------|-----|
| **Frontend** | [equxi.sithunyein.com](https://equxi.sithunyein.com) |
| **Program** | Devnet (run `./setup.sh` to deploy) |
| **GitHub** | [github.com/thesithunyein/equxi](https://github.com/thesithunyein/equxi) |

## Grant

Built for the [Agentic Engineering Grant](https://superteam.fun/earn/grants/agentic-engineering) by Superteam.

**Skills:** Frontend · Blockchain · Backend · Content

---

Built by [Sithu Nyein](https://sithunyein.com) · Generated with Codebuff
