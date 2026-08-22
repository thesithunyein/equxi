# @equxi/plugin-eliza

On-chain guardrails for Solana AI agents via [Equxi](https://equxi.sithunyein.com).

Adds spend limits, timelocks, and bond enforcement to any Solana agent built on [elizaOS](https://github.com/elizaOS/eliza).

## Install

```bash
npm install @equxi/plugin-eliza
```

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

## Program

- **Devnet**: `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`
- **Explorer**: https://explorer.solana.com/address/D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc?cluster=devnet

## License

MIT
