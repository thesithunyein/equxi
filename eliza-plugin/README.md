# @equxi/plugin-eliza

On-chain guardrails for Solana AI agents via [Equxi](https://equxi.sithunyein.com).

Adds spend limits, timelocks, and bond enforcement to any Solana agent built on [elizaOS](https://github.com/elizaOS/eliza).

## Install

**pnpm, straight from git today:**

```bash
pnpm add github:thesithunyein/equxi#path:eliza-plugin
```

**npm / yarn:** npm's git installer cannot target a subdirectory, so clone and install by path:

```bash
git clone https://github.com/thesithunyein/equxi.git
cd equxi/eliza-plugin
npm install
```

Then reference it by path in your agent's `package.json`:

```json
{
  "dependencies": {
    "@equxi/plugin-eliza": "file:../equxi/eliza-plugin"
  }
}
```

Once published, this becomes `npm install @equxi/plugin-eliza`.

The git install needs no build step — `dist/` is prebuilt and tracked in the repo (pnpm 10 and npm skip `prepare` scripts on git dependencies, so the compiled output ships in git itself).

## Quick Start

```typescript
import { equxiPlugin } from "@equxi/plugin-eliza";

// Add to your elizaOS agent config
const agent = {
  plugins: [equxiPlugin],
  settings: {
    WALLET_PUBLIC_KEY: "your-solana-wallet-public-key",
    SOLANA_RPC_URL: "https://api.devnet.solana.com", // optional
  },
};
```

## Actions

### EQUXI_REGISTER_AGENT

Register a new AI agent on Solana.

```
"Register my trading bot as an agent on Equxi"
```

### EQUXI_LOCK_BOND

Lock SOL as a safety bond.

```
"Lock 0.5 SOL as bond for my trading bot"
```

### EQUXI_ADD_CONSTRAINT

Add on-chain behavioral rules.

```
"Set a 1 SOL daily spend limit for my agent"
"Allow only Jupiter and Raydium programs"
```

### EQUXI_SLASH_BOND

Slash an agent's bond for rule violation.

```
"Slash 0.1 SOL from my agent for exceeding spend limit"
```

## How It Works

1. **Register** your agent on-chain (creates identity)
2. **Lock a bond** (SOL safety deposit)
3. **Add constraints** (spend limits, program allowlists, timelocks)
4. **Slash** when rules are violated (bond penalized)

All enforced on Solana. No oracles needed for quantitative rules.

## Verify a bond before you transact

Bond and slash history is public. Read it without a wallet:

- **Explorer**: https://equxi.sithunyein.com/explorer.html
- **Badge API**: `https://equxi.sithunyein.com/api/badge?agent=<agent-pda>`
- **Registry API**: `https://equxi.sithunyein.com/api/trust`

## Program

- **Devnet**: `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`
- **Explorer**: https://explorer.solana.com/address/D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc?cluster=devnet

## License

MIT
