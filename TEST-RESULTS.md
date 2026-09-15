# Equxi — Verification Status

> **Read this first.** Two different things live in this document, and they must not
> be confused:
>
> * **JavaScript/TypeScript** checks — these have been **executed** and the results
>   are recorded below. `npm run test:unit` runs **100** assertions over the wire
>   formats, PDA seeds, IDL, SDK, read layer, and read API with no validator. The
>   read API additionally has **live devnet evidence** (below), which is the one
>   place a real network was involved.
> * **Rust** checks — `anchor build` and `anchor test` have **never run**. The
>   authoring machine had no Rust linker at all (no `gcc`, no `ld`, no MSVC
>   `link.exe`, no Windows SDK), so the program has never been compiled. Treat every
>   Rust claim in this repository as **unverified by execution** until that run is
>   recorded here.
>
> The records marked **(v0.1)** are historical results for the original deployment.

## Verification matrix (v0.2)

| Check | Status | Notes |
|-------|--------|-------|
| `npm run test:unit` | ✅ **100 passing** | Wire formats, PDA seeds, IDL, SDK, read layer, read API |
| `tsc --noEmit` (tests) | ✅ **0 errors** | |
| `tsc --noEmit` (SDK) | ✅ **0 errors** | |
| `tsc --noEmit` (elizaOS plugin) | ✅ **0 errors** | Was **16 errors** before the rewrite |
| `node --check` (app, explorer, api, lib, dev-server) | ✅ **parses** | |
| Frontend v0.1/v0.2 version guard | ✅ **verified in a browser against live devnet** | Banner rendered, writes disabled — see below |
| Read API against live devnet | ✅ **returned real data** | See “Live devnet read” below |
| Trust Explorer rendered | ✅ **verified in a browser** | Screenshot reproduced below in prose; served by `dev-server.js` |
| `anchor build` | ⬜ **Not run** | No Rust linker on the authoring machine |
| `anchor test` | ⬜ **Not run** | Same reason |
| CI (Wire-format Unit Tests) | ⬜ **Not run** | Added in v0.2; needs a push to run |
| CI (Build & Test Program) | ⬜ **Not run** | Added in v0.2; needs a push to run |
| Devnet redeploy of v0.2 | ⬜ **Not deployed** | The v0.2 ABI differs from what is on chain |

Update this table as each check passes, with the actual command output.

### Bugs the unit tests found (and fixed)

These were live defects, not hypotheticals. Each was caught by running the suite:

| Bug | Impact |
|-----|--------|
| `anchor.utils.sha256.hash()` returns a **lossy UTF-8 decode** of the digest | Discriminators came out **empty**; every plugin transaction would have been rejected |
| The plugin's embedded IDL described a retired `operator` account on `create_bond`, took a `config` account on `add_constraint` that the program does not accept, and omitted `vault` on `execute_slash` | Every plugin instruction would have failed |
| The SDK's IDL was in the Anchor ≤0.29 shape (no `address`, `publicKey`, `{defined: "X"}`) | `new EquxiClient(provider)` **threw on construction** |
| The SDK's IDL instructions had no `discriminator` array | Anchor 0.30 does **not** recompute it — `new Program(...)` threw `Expected Buffer` |
| `decodeBond` / `decodeSlashRecord` asserted the wrong minimum length (107/267 vs 106/259) | Valid accounts would have been rejected as malformed |

### Frontend version guard against live devnet (executed)

Because the v0.2 frontend talks to a v0.1 program until redeploy, `app.js`
checks the live Config account size on load (v0.1 = 65 bytes, v0.2 = 73 after
the two vault counters) and, on v0.1, disables the Register/Lock/Rule/Slash
writes and shows a fixed banner instead of letting transactions fail.

Verified in a browser (dev server, `app.html`) against live devnet:

```
bannerPresent: true
bannerText: "This deployment is still the v0.1 program — the v0.2 upgrade
(escrow vault, owner-signed bonds, multi-constraint) is not live on devnet yet."
```

Detection is cached per page load and fails open (writes stay enabled) if the
RPC check itself errors, so a transient RPC outage can never brick the UI.

## Live devnet read (v0.1 program, executed)

This is the only check in this document that touched a real network. It is
recorded verbatim because it produced a finding that changed the code.

The read API was pointed at the deployed devnet program:

```bash
node -e "require('./api/trust.js').buildResponse({}, {fetchImpl: globalThis.fetch, now: <now>})"
```

Measured account sizes over RPC (`getProgramAccounts`, one call per
discriminator):

| Account | Count | Size on devnet | Size the v0.2 code expects | Match |
|---------|-------|----------------|---------------------------|-------|
| Agent | 1 | **116** | 118 | ❌ **v0.1 layout** |
| Bond | 1 | 106 | 106 | ✅ |
| Config | 1 | 65 | 65 | ✅ |
| Constraint | 1 | 339 | 339 | ✅ |
| SlashRecord | 2 | 259 | 259 | ✅ |
| Vault | **0** | — | 25 | ❌ **not deployed** |

The Agent row is why the endpoint failed on first contact with a hard
`Agent account is 116 bytes, expected at least 118`. That is a true statement
about the live program: **the deployment on devnet is v0.1**, so it has no
`constraint_count` and no escrow vault.

Rather than leave the only public read path broken against the only deployed
program, `decodeAgent` now selects the layout from the account length, decodes
both, and reports which one it used. The API then says so in `warnings`:

```json
{
  "counts": { "agents": 1, "bonds": 1, "slashes": 2, "constraints": 1 },
  "totals": { "slashCount": 2, "openSlashes": 2, "bondedLamports": "300000000", "bondedSol": 0.3 },
  "vault": null,
  "warnings": [
    "1 agent(s) use the v0.1 account layout (116 bytes): constraint counts are unavailable, and this deployment predates the v0.2 escrow vault.",
    "No Vault account exists on this deployment, so slashed collateral is not yet held in program-owned escrow."
  ],
  "agents": [{
    "name": "Augur", "layout": "v1", "status": "active", "constraintCount": 0,
    "profile": {
      "grade": "D", "score": 48, "onChainTrustScore": 50,
      "bond": { "amountSol": 0.3, "isActive": true, "locked": true },
      "stats": { "slashCount": 2, "openSlashes": 2, "uncompensatedLamports": "200000000" }
    }
  }]
}
```

Score check by hand: `100 − 10×2 (two slashes) − 12×2 (two unpaid, capped at 30) − 8 (bond under 1 SOL) = 48`.

**What this proves and what it does not.** The read path works against the real
deployed program: real PDAs, real bonds, real slash records, real lamport totals.
It does *not* prove anything about v0.2, because v0.2 is not deployed — which is
why the vault is absent and the layout is reported as `v1`.

## Trust Explorer — browser-verified

`explorer.html` was served by `node dev-server.js` and rendered against the live
read API above. Observed in the browser:

| Surface | Observed |
|---------|----------|
| Summary tiles | Agents `1`, Collateral at risk `0.3000 SOL`, Slashes `2` / `2 still owed`, Escrow `—` / “vault not initialised” |
| Registry table | `Augur`, grade `D` (`48`), bond `0.3000 SOL`, `2 owed`, status `active`, rules `0` |
| Detail panel | Bond `300000000 lamports`, locked until `2026-09-21` · `locked`, `active: yes` |
| Slash history | Two rows, `0.1000 SOL` each, both `owed` |
| Warnings | “Bond is under 1 SOL…”, “2 slashes recorded but not yet compensated…”, “On-chain trust_score is 50; the derived score is 48…” |
| Deep link | `explorer.html?agent=<pda>` prefilled the input and opened that agent |
| Error path | `?agent=not-a-real-key` rendered “Could not read the program. agent must be a base58-encoded 32-byte pubkey.” and **no** registry, rather than “no agents found” |

## Program Deployment — (v0.1)

| Field | Value |
|-------|-------|
| Program ID | `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc` |
| Network | Solana Devnet |
| Deployment TX | [`4wvtm6ijyocz5YP9BVtwXrmKkKagMQg2RJHqd5nj5HwyT8FBmShCFJBhVQPzx7QpH4cTH5ibyVjestucEyk3bkcw`](https://explorer.solana.com/tx/4wvtm6ijyocz5YP9BVtwXrmKkKagMQg2RJHqd5nj5HwyT8FBmShCFJBhVQPzx7QpH4cTH5ibyVjestucEyk3bkcw?cluster=devnet) |
| Deployment TX (v0.2) | ⬜ not yet deployed |
| Deployer Wallet | `DWfUjm4NfFW4HRjbtkwcHwAn5UA4ZedSSmaxonyYDVTh` |
| Deployed | August 21, 2026 |
| Balance | ~7.8 SOL remaining |

## Account Layouts (v0.2)

Sizes are `8 (discriminator) + INIT_SPACE`.

### Config — 65 bytes

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | discriminator |
| 8 | 32 | admin |
| 40 | 8 | total_agents |
| 48 | 8 | total_bonds |
| 56 | 8 | total_slashed |
| 64 | 1 | bumped |

### Vault — 25 bytes *(new in v0.2)*

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | discriminator |
| 8 | 8 | total_slashed |
| 16 | 8 | total_compensated |
| 24 | 1 | bumped |

### Agent — 118 bytes *(v0.2 adds `constraint_count`)*

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | discriminator |
| 8 | 32 | owner |
| 40 | 32 | name |
| 72 | 1 | agent_type |
| 73 | 1 | trust_score |
| 74 | 1 | status |
| 75 | 32 | bond_address |
| **107** | **2** | **constraint_count (u16)** |
| 109 | 8 | created_at |
| 117 | 1 | bumped |

> v0.1 was 116 bytes with `created_at` at offset 107. Any client decoding the Agent
> account must be updated — `app.js` and the eliza service have been.

### Bond — 106 bytes

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | discriminator |
| 8 | 32 | agent |
| 40 | 32 | operator |
| 72 | 8 | amount |
| 80 | 8 | lock_duration |
| 88 | 8 | locked_at |
| 96 | 8 | expires_at |
| 104 | 1 | is_active |
| 105 | 1 | bumped |

### Constraint — 339 bytes

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | discriminator |
| 8 | 32 | agent |
| 40 | 1 | constraint_type |
| 41 | 288 | params |
| 329 | 1 | is_enforced |
| 330 | 8 | created_at |
| 338 | 1 | bumped |

`params`: `max_amount` (8) @41, `max_per_period` (8) @49, `period_seconds` (8) @57,
`timelock_seconds` (8) @65, `allowed_programs` (256) @73.

### SlashRecord — 219 bytes

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | discriminator |
| 8 | 32 | agent |
| 40 | 32 | authority |
| 72 | 8 | amount |
| 80 | 128 | reason |
| 208 | 8 | nonce |
| 216 | 8 | timestamp |
| 224 | 33 | victim (Option<Pubkey>) |
| 257 | 1 | compensated |
| 258 | 1 | bumped |

## PDA Seeds (v0.2)

| Account | Seeds |
|---------|-------|
| Config | `["config"]` |
| Vault | `["vault"]` |
| Agent | `["agent", owner, name]` |
| Bond | `["bond", agent]` |
| Constraint | `["constraint", agent, constraint_count (u16 LE)]` |
| SlashRecord | `["slash", agent, config.total_slashed (u64 LE)]` |

## Error Codes

`programs/equxi/src/error.rs` defines the following variants. Verify the count against
the source rather than trusting a number in this document.

`NameTooLong`, `BondTooSmall`, `BondInactive`, `BondNotExpired`, `InsufficientBond`,
`Unauthorized`, `AgentNotActive`, `InvalidTrustScore`, `SlashingAuthorityRequired`,
`InvalidAmount`, `ExceedsSlashAmount`, `VaultInsufficient`, `AlreadyCompensated`,
`TooManyConstraints`, `InvalidAdminAuthority`, `ProgramDataMismatch`, `Overflow`.

> v0.1 listed 12 codes while the source defined 13. Three of them
> (`AuthorityRequired`, `AlreadyDeactivated`, `ConstraintExists`) were never thrown.
> `AuthorityRequired` and `AlreadyDeactivated` have been removed.

## Test Coverage (v0.2 suite, not yet executed)

`tests/equxi.test.ts` covers:

| Case | Type |
|------|------|
| initialize creates config + vault | happy path |
| initialize rejects a non-upgrade-authority | negative |
| register agents | happy path |
| create bonds | happy path |
| **bond rejected when the signer is not the agent owner** | regression (squatting) |
| **slash moves funds into the vault, admin does not profit** | regression (custody) |
| slash rejected when larger than the bond | negative |
| **compensation draws from escrow and leaves `bond.amount` intact** | regression (stranded lamports) |
| double compensation rejected | negative |
| over-compensation rejected | negative |
| **two constraints on one agent** | regression (PDA collision) |
| withdraw before expiry rejected | negative |
| **withdraw closes the bond and returns the collateral** | happy path |

## Reproducing

```bash
npm install
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json --force
anchor keys sync          # align target/deploy keypair with declare_id!
anchor build
anchor test
```

CI runs the same sequence in the `Build & Test Program` job.
