# Agent Accountability Standard (AAS-1)

**Status:** Draft
**Scope:** Bonds, violations, and victim compensation for autonomous agents on Solana
**Reference implementation:** Equxi (`D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc`)

---

## 1. Why this exists

Autonomous agents now hold wallets, trade, pay APIs, and act on behalf of
operators. Platforms have solved *permission* — allowlists, spend caps, approval
prompts. Almost none have solved **consequence**.

A permission system answers *"what is this agent allowed to do?"*
It does not answer *"who pays when the agent does the wrong thing anyway?"*

AAS-1 defines the missing layer: an agent that can be **held economically
accountable**, with compensation paid to the injured party without a human
custodian in the loop.

## 2. Core concepts

| Term | Definition |
|------|------------|
| **Agent** | A registered identity that an operator runs. Owns a wallet; may hold a bond. |
| **Bond** | Lamports the operator locks as collateral. Only the operator's own funds. |
| **Constraint** | A recorded behavioral rule (spend limit, allowlist, timelock, velocity). |
| **Violation** | An observed breach of a constraint. Detection may be off-chain; the record is on-chain. |
| **Slash** | A seizure of collateral, moved into escrow. Not to an operator or admin wallet. |
| **Vault** | A program-owned PDA holding slashed funds until they are paid out. |
| **Compensation** | A transfer from the vault to an injured party. |

## 3. Required invariants

An implementation claiming AAS-1 compliance MUST satisfy all of the following.

### 3.1 Custody
- **I1.** Slashed lamports MUST move from the bond into a program-owned vault.
  They MUST NOT be transferred to an admin, operator, or any externally-owned account.
- **I2.** Compensation MUST be paid from the vault.
- **I3.** No key, including the protocol admin, may unilaterally withdraw vault funds
  to itself.

### 3.2 Accounting
- **I4.** `vault.lamports() == rent_exempt_min + (total_slashed - total_compensated)`.
- **I5.** A bond's recorded amount MUST equal the collateral it actually holds.
  Compensation MUST NOT mutate the bond's recorded amount.
- **I6.** Closing or withdrawing a bond MUST return all its lamports. No funds may
  be left stranded in a closed or unreachable account.

### 3.3 Authorization
- **I7.** Only the agent's owner may create, top up, or withdraw its bond. An owner
  signature is REQUIRED — an address check is insufficient.
- **I8.** Constraint creation MUST be authorized by the agent's owner.
- **I9.** Slashing and compensation MUST be restricted to an explicitly configured
  authority, and that authority MUST be derivable from on-chain state, never from
  an unauthenticated instruction argument.

### 3.4 Bounds
- **I10.** `slash_amount <= bond.amount`.
- **I11.** `compensation <= slash_record.amount`.
- **I12.** `sum(compensations for a slash) <= slash_record.amount`.
- **I13.** A slash record MUST NOT be compensated more than once.
- **I14.** An agent MUST be able to hold more than one constraint.

### 3.5 Reading
- **I15.** A reader MUST be able to determine, for any agent, whether collateral is
  posted and whether each recorded violation was compensated, without trusting the
  agent or the operator.
- **I16.** Absence of evidence MUST be reported as absence. An agent with no bond
  MUST NOT receive a passing grade; a failure to read the chain MUST NOT be
  reported as an empty registry.
- **I17.** A value derived from chain history MUST be distinguishable from a value
  asserted by the program admin. Implementations MUST NOT present `trust_score` as
  if it were evidence.
- **I18.** A reader MUST report which account layout it decoded, so that a partial
  reading is not mistaken for a complete one.

## 4. Account model

```
Config  — singleton
    admin              : Pubkey   # slash / compensate authority
    total_agents       : u64
    total_bonds        : u64
    total_slashed      : u64      # slash nonce source
    bumped             : u8

Vault   — singleton, program-owned
    total_slashed      : u64
    total_compensated  : u64
    bumped             : u8

Agent   — PDA ["agent", owner, name]
    owner              : Pubkey
    name               : [u8; 32]
    agent_type         : AgentType
    trust_score        : u8      # 0-100
    status             : AgentStatus
    bond_address       : Pubkey
    constraint_count   : u16
    created_at         : i64
    bumped             : u8

Bond    — PDA ["bond", agent]
    agent              : Pubkey
    operator           : Pubkey
    amount             : u64
    lock_duration      : i64
    locked_at          : i64
    expires_at         : i64
    is_active          : bool
    bumped             : u8

Constraint — PDA ["constraint", agent, constraint_count]
    agent              : Pubkey
    constraint_type    : ConstraintType
    params             : ConstraintParams
    is_enforced        : bool
    created_at         : i64
    bumped             : u8

SlashRecord — PDA ["slash", agent, config.total_slashed]
    agent              : Pubkey
    authority          : Pubkey
    amount             : u64
    reason             : [u8; 128]
    nonce              : u64
    timestamp          : i64
    victim             : Option<Pubkey>
    compensated        : bool
    bumped             : u8
```

**Note on the constraint seed.** Seeding constraints on a *global* counter is a
defect: two constraints for the same agent derive the same PDA and the second
creation fails, silently limiting every agent to one rule. Use a per-agent
counter.

## 5. Lifecycle

```
register_agent
      |
      v
 create_bond ──────────────► [locked] ──expiry──► withdraw_bond (closes account)
      |                          |
      |                       execute_slash
      |                          |
      |                          v
      |                    vault  (+slash_amount)
      |                          |
      |                    compensate_victim
      |                          |
      |                          v
      |                    victim  (+amount)
      |
 add_constraint (xN)
```

## 6. Conformance checklist

- [ ] Slashed funds land in a program-owned vault, never an admin wallet
- [ ] Vault accounting invariant holds after every instruction
- [ ] Compensation never mutates the bond's recorded amount
- [ ] Bond withdrawal returns all lamports and closes the account
- [ ] Bond creation requires an owner signature
- [ ] Slash authority is derived from on-chain config, not an instruction argument
- [ ] `compensation <= slash.amount` and each slash compensates at most once
- [ ] Agents can hold multiple constraints
- [ ] Tests cover: unauthorized bond creation, double compensation,
      over-slash, over-compensation, multi-constraint, and post-expiry withdrawal
- [ ] A public read path answers "bonded? slashed? compensated?" for any agent
- [ ] An agent with no bond is reported as ungraded, never as passing
- [ ] A read failure is reported as a failure, never as an empty result
- [ ] Derived values are labelled as derived, separately from admin-set fields
- [ ] The decoded account layout is reported alongside the data

## 7. Known open problems

AAS-1 (draft) does **not** yet specify:

1. **On-chain violation proofs.** Detection is off-chain; a slash is asserted, not
   proven. A future revision should define a verifiable violation witness.
2. **Dispute resolution.** A slash is currently final. Optimistic slashing with a
   challenge window and an arbiter is the natural next step.
3. **Decentralized slashing authority.** A single admin key is a centralization
   point. A staked watcher network with slashing rewards is preferable.
4. **Derived trust scores.** `trust_score` is currently set manually. It should be
   a pure function of bond size, uptime, violation history, and settled volume.
   §3.5 requires readers to compute and label such a score client-side in the
   meantime; `sdk/src/read.ts` and `lib/equxi-layout.js` are two implementations,
   and they must agree (see `tests/unit/read.test.ts`).
5. **Cross-chain bonds.** Attesting a bond on one chain for use on another.
6. **Registry paging.** `getProgramAccounts` returns at most ~100 KB per call, so
   the reference read API can only scan a registry of roughly 850 accounts before
   the RPC refuses. A conforming reader should page, or index into a database.

## 8. Reference implementation notes

Equxi implements the model above in Anchor 0.30.1. Deliberate scope boundaries:

- The protocol holds **only operator collateral**. It is not a custodian of user
  funds, which keeps it out of money-transmission territory.
- Enforcement is scoped to **accountability**, not **permission**. Platforms such
  as agent-launch systems already ship allowlists and approval prompts; AAS-1
  layers economic consequence on top rather than competing with them.

Contributions and implementations welcome.
