# @equxi/sdk

TypeScript SDK for [Equxi](https://equxi.sithunyein.com) — slashable collateral and accountability for AI agents on Solana.

An agent's operator bonds SOL behind the agent. If the agent breaks a rule, anyone can trigger a proportional slash on-chain, and victims get compensated from the bond. The bond is the agent's skin in the game.

## Install

**pnpm, straight from git today:**

```bash
pnpm add github:thesithunyein/equxi#path:sdk
```

**npm / yarn:** npm's git installer cannot target a monorepo subdirectory, so clone and install by path:

```bash
git clone https://github.com/thesithunyein/equxi.git
# then in your package.json:
#   "dependencies": { "@equxi/sdk": "file:../equxi/sdk" }
```

**npm registry** (`npm install @equxi/sdk`): the publish is pending an npm org — check the [package page](https://www.npmjs.com/package/@equxi/sdk) for availability.

## Quick start

```typescript
import { EquxiClient } from "@equxi/sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";

const connection = new Connection("https://api.devnet.solana.com");
const wallet = new Wallet(Keypair.generate()); // your agent's operator wallet
const client = new EquxiClient(new AnchorProvider(connection, wallet, {}));

// 1. Register an agent (the operator key owns it)
await client.registerAgent("MyTradingAgent", { trader: {} });

// 2. Bond 1 SOL of collateral behind it
const [agentPDA] = client.findAgentPDA(wallet.publicKey, "MyTradingAgent");
await client.createBond(agentPDA, new BN(1_000_000_000), new BN(86400 * 30));

// 3. Add a guardrail as a bond constraint
await client.addConstraint(agentPDA, { maxTransfer: {} }, { maxLamports: new BN(100_000_000) });

// 4. Anyone can audit the agent — bond, slashes, derived grade
const trust = await client.getTrustProfile(agentPDA);
console.log(trust.grade, trust.bond?.amount.toString());
```

That's the whole integration. Any third party can verify the bond, read its constraints, and trigger a slash if the agent misbehaves — no trust in the operator required.

## API surface

`EquxiClient` (constructed with an Anchor `Provider`):

- **Lifecycle** — `initialize`, `registerAgent`, `createBond`, `withdrawBond`
- **Guardrails** — `addConstraint`
- **Enforcement** — `executeSlash`, `compensateVictim`
- **Reads** — `getAgent`, `getBond`, `getConfig`, `getVault`, `listAgents`, `listBonds`, `listSlashRecords`, `listConstraints`
- **Trust** — `getTrustProfile(agentPDA)` → bond, slash history, derived grade — the single call a counterparty needs

Plus PDA helpers (`findConfigPDA`, `findVaultPDA`, `findAgentPDA`, `findBondPDA`, `findConstraintPDA`, `findProgramDataPDA`) and standalone listing functions in `read.ts`.

## Program & network

| | |
|---|---|
| Cluster | Solana Devnet |
| Program | `8RsJkPRmG9FsfP9d3LzZ3TmWRQK3YySgM4uA8EwKXVsM` |
| IDL | Bundled at `dist/idl/equxi.json` — spec-0.30 account flags, wire-verified by regression test |
| License | MIT |

## Links

- Live app: <https://equxi.sithunyein.com/app.html>
- Explorer (verify any agent's bond): <https://equxi.sithunyein.com/explorer.html>
- elizaOS plugin: [`@equxi/plugin-eliza`](https://github.com/thesithunyein/equxi/tree/main/eliza-plugin)
- Repo: <https://github.com/thesithunyein/equxi>
