# @equxi/sdk

TypeScript SDK for [Equxi](https://equxi.sithunyein.com) — slashable collateral and accountability for AI agents on Solana.

An agent's operator bonds SOL. If the agent breaks a rule you set — spend cap, per-target cap, timelock — anyone can trigger a proportional slash on-chain. The bond is the agent's skin in the game.

## Install

**npm** (coming — publish pending):

```bash
npm install @equxi/sdk
```

**pnpm, straight from git today:**

```bash
pnpm add github:thesithunyein/equxi#path:sdk
```

**npm / yarn from git:** clone the repo and install by path —

```bash
git clone https://github.com/thesithunyein/equxi.git
# then in your package.json:
#   "dependencies": { "@equxi/sdk": "file:../equxi/sdk" }
```

## Quick start

```typescript
import { EquxiSDK, findConfigPDA } from "@equxi/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const wallet = Keypair.generate(); // your agent's operator wallet

const sdk = new EquxiSDK({ connection, wallet });

// 1. Register an agent (one-time, ~0.002 SOL rent)
await sdk.registerAgent("MyTradingAgent", { trader: {} });

// 2. Bond collateral behind it
await sdk.createBond(1_000_000_000); // 1 SOL

// 3. Add a guardrail: max 0.1 SOL per outbound transfer
await sdk.addConstraint({ maxTransfer: 100_000_000 });
```

That's the whole integration. Any third party can then verify the bond, read its constraints, and trigger a slash if the agent misbehaves — no trust in the operator required.

## Program & network

| | |
|---|---|
| Cluster | Solana Devnet |
| Program | `8RsJkPRmG9FsfP9d3LzZ3TmWRQK3YySgM4uA8EwKXVsM` |
| IDL | Bundled at `dist/idl/equxi.json` (also importable from `@equxi/sdk/idl`) |
| License | MIT |

The bundled IDL carries spec-0.30 account flags (`writable`/`signer`), so instructions built through `@coral-xyz/anchor`'s `Program` go on the wire with correct privileges — verified by a wire-level regression test in the repo.

## Links

- Live app: <https://equxi.sithunyein.com/app.html>
- Explorer (verify any agent's bond): <https://equxi.sithunyein.com/explorer.html>
- elizaOS plugin: [`@equxi/plugin-eliza`](https://github.com/thesithunyein/equxi/tree/main/eliza-plugin)
- Repo: <https://github.com/thesithunyein/equxi>
