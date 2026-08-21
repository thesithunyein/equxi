<p align="center">
  <img src="assets/logo.webp" alt="Equxi Logo" width="120" />
</p>

<h1 align="center">Equxi</h1>

<p align="center"><strong>Solana-Native Trust Layer for AI Agents</strong></p>

<p align="center">
  <a href="https://equxi.sithunyein.com">Live Site</a> •
  <a href="https://superteam.fun/earn/grants/agentic-engineering">Superteam Grant</a> •
  <a href="#quickstart">Quick Start</a> •
  <a href="#api">SDK Docs</a>
</p>

---

## The Problem

AI agents lack economic accountability. Nobody can safely trust an autonomous agent with real capital or financial obligations because:

- **Counterparties refuse to deal** with agents that can lose money or misbehave with no recourse
- **Traditional wallets only hold funds** — they cannot enforce on-chain behavioral constraints
- **No automatic collateral seizure** to compensate victims when an agent misbehaves

## The Solution

Equxi provides **enforceable on-chain behavioral constraints** for AI agents on Solana:

1. **Bond** — Agents' operators lock SOL collateral as a behavioral guarantee
2. **Enforce** — Behavioral constraints (spend limits, allowlisted programs, timelocks, velocity) are enforced on-chain
3. **Slash** — When an agent violates constraints, its bond is automatically slashed
4. **Compensate** — Slashed collateral compensates affected counterparties

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Equxi Protocol                       │
├─────────────────────────────────────────────────────────┤
│  Solana Program (Anchor)                               │
│  ├── register_agent()     — Create agent identity      │
│  ├── create_bond()        — Lock SOL collateral        │
│  ├── add_constraint()     — Deploy behavioral rules    │
│  ├── execute_slash()      — Penalize bond on violation │
│  └── compensate_victim() — Pay out from slashed bond   │
├─────────────────────────────────────────────────────────┤
│  TypeScript SDK                                        │
│  ├── EquxiClient.registerAgent()                       │
│  ├── EquxiClient.createBond()                          │
│  ├── EquxiClient.addConstraint()                       │
│  ├── EquxiClient.executeSlash()                        │
│  └── EquxiClient.compensateVictim()                    │
├─────────────────────────────────────────────────────────┤
│  Frontend (Dashboard)                                  │
│  ├── Phantom wallet integration                        │
│  ├── Agent management UI                               │
│  ├── Bond tracking                                     │
│  ├── Constraint configuration                          │
│  └── Slashing interface                                │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Solana CLI](https://docs.solanalabs.com/cli/install) (v1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (v0.30+)
- [Node.js](https://nodejs.org/) (v18+)

### 1. Install Dependencies

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Configure for devnet
solana config set --url devnet

# Create wallet (if needed)
solana-keygen new

# Request airdrop for testing
solana airdrop 2

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1
```

### 2. Build & Deploy the Program

```bash
cd equxi

# Install JS dependencies
yarn install

# Build the Anchor program
anchor build

# Get program ID
solana address -k target/deploy/equxi-keypair.json

# Update program ID in lib.rs and Anchor.toml
# Then deploy
anchor deploy --provider.cluster devnet
```

### 3. Run the Frontend

```bash
# Serve the dashboard
npx serve .

# Open http://localhost:3000/app.html
```

## Program Instructions

### `register_agent`

```rust
pub fn register_agent(
    ctx: Context<RegisterAgent>,
    name: String,           // Agent name (max 32 chars)
    agent_type: AgentType,  // Trader, Oracle, DeFi, Payment, etc.
) -> Result<()>
```

Creates an on-chain agent identity linked to an operator wallet.

### `create_bond`

```rust
pub fn create_bond(
    ctx: Context<CreateBond>,
    amount: u64,            // SOL to lock (min 0.1 SOL)
    lock_duration: i64,     // Lock period in seconds
) -> Result<()>
```

Transfers SOL from operator to a PDA that acts as the bond collateral.

### `add_constraint`

```rust
pub fn add_constraint(
    ctx: Context<AddConstraint>,
    constraint_type: ConstraintType,  // SpendLimit, ProgramAllowlist, Timelock, Velocity
    params: ConstraintParams,         // Type-specific parameters
) -> Result<()>
```

Deploys an on-chain behavioral constraint for an agent.

### `execute_slash`

```rust
pub fn execute_slash(
    ctx: Context<ExecuteSlash>,
    reason: String,         // Violation description
    slash_amount: u64,      // Amount to slash (lamports)
) -> Result<()>
```

Penalizes an agent's bond and transfers slashed SOL to treasury.

### `compensate_victim`

```rust
pub fn compensate_victim(
    ctx: Context<CompensateVictim>,
    amount: u64,            // Compensation amount
) -> Result<()>
```

Transfers SOL from a slashed bond to the affected counterparty.

## SDK Usage

```typescript
import { EquxiClient } from "@equxi/sdk";
import { AnchorProvider } from "@coral-xyz/anchor";

// Initialize
const provider = new AnchorProvider(connection, wallet, {});
const client = new EquxiClient(provider);

// Register an agent
const { agentPDA } = await client.registerAgent("AlphaTrader", { trader: {} });

// Create a bond (5 SOL, 30 days)
const { bondPDA } = await client.createBond(
  agentPDA,
  new BN(5_000_000_000),  // 5 SOL in lamports
  new BN(30 * 24 * 60 * 60)  // 30 days in seconds
);

// Add spend limit (max 500 SOL per tx)
await client.addConstraint(agentPDA, { spendLimit: {} }, {
  maxAmount: new BN(500_000_000_000),
  maxPerPeriod: new BN(0),
  periodSeconds: new BN(0),
  timelockSeconds: new BN(0),
  allowedPrograms: Array(8).fill(PublicKey.default),
});

// Execute slashing (if agent violates constraints)
await client.executeSlash(agentPDA, "Exceeded spend limit", new BN(1_000_000_000));

// Compensate victim
await client.compensateVictim(agentPDA, slashTimestamp, victimWallet, amount);
```

## Constraint Types

| Type | Description | Params |
|------|-------------|--------|
| **SpendLimit** | Max SOL per transaction | `maxAmount` |
| **ProgramAllowlist** | Only allowed Solana programs | `allowedPrograms[8]` |
| **Timelock** | Delay before withdrawals execute | `timelockSeconds` |
| **Velocity** | Max transactions per time period | `maxPerPeriod`, `periodSeconds` |

## Testing

```bash
# Run Anchor tests
anchor test

# Or run TypeScript tests directly
cd sdk && yarn test
```

## Project Structure

```
equxi/
├── programs/equxi/           # Solana program (Rust)
│   └── src/
│       ├── lib.rs            # Entry point
│       ├── state.rs          # Account structures
│       ├── error.rs          # Error codes
│       └── instructions/     # Instruction handlers
├── sdk/                      # TypeScript SDK
│   └── src/
│       ├── index.ts          # Client API
│       └── types/            # TypeScript types
├── tests/                    # Anchor tests
├── app.html                  # Dashboard frontend
├── app.css                   # Dashboard styles
├── app.js                    # Dashboard logic + wallet
├── index.html                # Landing page
├── styles.css                # Landing styles
├── main.js                   # Landing animations
└── README.md                 # This file
```

## Deployed

- **Frontend**: [equxi.sithunyein.com](https://equxi.sithunyein.com)
- **Program**: Devnet (deploy after `anchor deploy`)
- **GitHub**: [github.com/thesithunyein/equxi](https://github.com/thesithunyein/equxi)

## Grant

This project is built for the [Agentic Engineering Grant](https://superteam.fun/earn/grants/agentic-engineering) program by Superteam.

---

Built by [Sithu Nyein](https://sithunyein.com) • Generated with Codebuff
