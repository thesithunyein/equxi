# Equxi — Test Results

## Program Deployment (Verified)

| Field | Value |
|-------|-------|
| Program ID | `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc` |
| Network | Solana Devnet |
| Deployment TX | [`4wvtm6ijyocz5YP9BVtwXrmKkKagMQg2RJHqd5nj5HwyT8FBmShCFJBhVQPzx7QpH4cTH5ibyVjestucEyk3bkcw`](https://explorer.solana.com/tx/4wvtm6ijyocz5YP9BVtwXrmKkKagMQg2RJHqd5nj5HwyT8FBmShCFJBhVQPzx7QpH4cTH5ibyVjestucEyk3bkcw?cluster=devnet) |
| Deployer Wallet | `DWfUjm4NfFW4HRjbtkwcHwAn5UA4ZedSSmaxonyYDVTh` |
| Deployed | August 21, 2026 |
| Balance | ~7.8 SOL remaining |

## Compilation (Verified)

```
$ cargo build-sbf
Finished release [optimized] target(s) in 42.15s
```

- Binary: `target/deploy/equxi.so` (312 KB)
- Solana CLI: 2.1.21
- Rust SBPF Toolchain: 1.89.0

## CI/CD (Verified)

| Run | Status | Duration |
|-----|--------|----------|
| CI #32521679645 | ✅ Success | 20s |
| CI #32520817971 | ✅ Success | 20s |
| CI #32520012370 | ✅ Success | 20s |
| CI #32519302853 | ✅ Success | 24s |
| CI #32514508274 | ✅ Success | 20s |

All checks: Lint & Typecheck + Verify Project (file structure, program existence, frontend validation).

## Account Layouts (Verified Against Source)

### Config Account (65 bytes)
```
Offset  Size  Field
0       8     Discriminator (SHA256("account:Config")[0..8])
8       32    admin (Pubkey)
40      8     total_agents (u64)
48      8     total_bonds (u64)
56      8     total_slashed (u64)
64      1     bumped (u8)
```

### Agent Account (116 bytes)
```
Offset  Size  Field
0       8     Discriminator
8       32    owner (Pubkey)
40      32    name ([u8; 32])
72      1     agent_type (enum)
73      1     trust_score (u8)
74      1     status (enum)
75      32    bond_address (Pubkey)
107     8     created_at (i64)
115     1     bumped (u8)
```

### Bond Account (106 bytes)
```
Offset  Size  Field
0       8     Discriminator
8       32    agent (Pubkey)
40      32    operator (Pubkey)
72      8     amount (u64)
80      8     lock_duration (i64)
88      8     locked_at (i64)
96      8     expires_at (i64)
104     1     is_active (bool)
105     1     bumped (u8)
```

### Constraint Account (339 bytes)
```
Offset  Size  Field
0       8     Discriminator
8       32    agent (Pubkey)
40      1     constraint_type (enum)
41      288   params (ConstraintParams)
            41      8     max_amount (u64)
            49      8     max_per_period (u64)
            57      8     period_seconds (i64)
            65      8     timelock_seconds (i64)
            73      256   allowed_programs ([Pubkey; 8])
329     1     is_enforced (bool)
330     8     created_at (i64)
338     1     bumped (u8)
```

## Instruction Discriminators (Anchor Standard)

| Instruction | Discriminator (SHA256) |
|-------------|----------------------|
| `initialize` | `global:initialize` → 8 bytes |
| `register_agent` | `global:register_agent` → 8 bytes |
| `create_bond` | `global:create_bond` → 8 bytes |
| `withdraw_bond` | `global:withdraw_bond` → 8 bytes |
| `add_constraint` | `global:add_constraint` → 8 bytes |
| `execute_slash` | `global:execute_slash` → 8 bytes |
| `compensate_victim` | `global:compensate_victim` → 8 bytes |
| `update_trust_score` | `global:update_trust_score` → 8 bytes |

## Program Instructions (Source Verified)

```rust
// 8 instructions in programs/equxi/src/lib.rs
pub fn initialize(ctx, admin) -> Result<()>
pub fn register_agent(ctx, name, agent_type) -> Result<()>
pub fn create_bond(ctx, amount, lock_duration) -> Result<()>
pub fn withdraw_bond(ctx) -> Result<()>
pub fn add_constraint(ctx, constraint_type, params) -> Result<()>
pub fn execute_slash(ctx, reason, slash_amount) -> Result<()>
pub fn compensate_victim(ctx, amount) -> Result<()>
pub fn update_trust_score(ctx, score) -> Result<()>
```

## Frontend-Program Integration

| Component | Status | Notes |
|-----------|--------|-------|
| Wallet Connection | ✅ Working | Phantom auto-reconnect, balance display |
| Instruction Data | ✅ Fixed | 8-byte Anchor discriminators + borsh encoding |
| Account Fetching | ✅ Fixed | Discriminator-based type matching (not dataSize) |
| PDA Derivation | ✅ Matching | Seeds match Rust `#[account]` constraints |
| TX Confirmation | ✅ Working | Blockhash confirmation, Explorer links |
| Balance Refresh | ✅ Working | Auto-refreshes after every transaction |
| Activity Feed | ✅ Working | On-chain data + real tx history from RPC |

## SDK Structure (Source Verified)

```typescript
// 9 methods in sdk/src/index.ts
registerAgent(name, agentType) → { agentPDA, tx }
createBond(agentPDA, amount, lockDuration) → { bondPDA, tx }
withdrawBond(agentPDA) → { tx }
addConstraint(agentPDA, constraintType, params) → { constraintPDA, tx }
executeSlash(agentPDA, reason, slashAmount) → { slashPDA, tx }
compensateVictim(agentPDA, slashNonce, victim, amount) → { tx }
getAgent(agentPDA) → Agent
getBond(bondPDA) → Bond
getConfig() → Config
```

## Error Codes (Source Verified)

12 custom error codes in `programs/equxi/src/error.rs`:
- Unauthorized, AgentAlreadyRegistered, BondAlreadyExists, BondNotExpired
- BondExpired, InsufficientFunds, AgentNotActive, AgentAlreadySlashed
- ConstraintViolation, InvalidConstraint, InvalidAmount, MathOverflow
