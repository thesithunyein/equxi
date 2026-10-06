# SECURITY-AUDIT.md — strict review for the Colosseum sidetracks

Audited 2026-10-05 against the code at commit `4b3c3cd` (the repairs below land on
top of it). Method: read the program, the API functions, the scripts and the
frontend; grep for the claimed mechanisms before reviewing them; run the unit
suite, typecheck, and the live-state checks already recorded in
`TEST-RESULTS.md`. This is a source-level review — not an external audit, not
fuzzing, not formal verification — and it says so where that matters.

## 0. Premise corrections (read first)

Three of the five areas describe mechanisms this repository **does not contain**.
Reviewing them as if they existed would produce theater, not security:

| Area as posed | What actually exists |
|---|---|
| "Yellowstone gRPC / Mirage WebSocket real-time telemetry" (Solami) | **Nothing.** Solami was never entered; `grep -rn "yellowstone\|grpc\|WebSocket"` over all sources returns no matches (only a transitive string inside `package-lock.json`). There is no stream to lose, recover, or sanitize. |
| "How does our program verify via CPI that quote tokens arrive from an authentic Meteora cp-amm vault" | **No CPI exists anywhere in the program.** The only `CpiContext` uses are three `SystemProgram::transfer` calls (`create_bond.rs:53`, `top_up_bond.rs:71`, `migrate_agent.rs:127`). The Meteora launch is script-driven with an evidence page — a documented choice, not an on-chain graduation attestation. |
| "Our Next.js API proxy" | **No Next.js and no proxy.** `vercel.json` sets `"buildCommand": null`; `api/*.js` are plain Vercel Node functions, and `dev-server.js` is a local shim. `api/markets.js` is the function itself. |
| "validate that trade signatures match the actual operator's agent PDA" | Panta's data model has **no agent PDA**. Identity is wallet + `marketId` + transaction signature, and attribution verification is Panta's server-side, fail-closed job (`TX_MISMATCH` etc. — docs.panta.market, checked today). The agent reference lives in the market's question text and resolution rule. |

Everything below audits what exists, then states what would be required to make
the non-existent claims true.

---

## 1. Account serialization boundary — PASS, no change needed

**Question:** does `migrate_agent.rs` zero the two bytes of `constraint_count`,
leak uninitialized memory, or panic on old accounts?

**Verdict: correct on all three counts.**

1. **The two bytes are always written, with a validated value.**
   `handler` first reads and verifies the account (owner is this program, length
   is exactly `AGENT_V1_LEN = 116`, discriminator is `Agent`), then
   `realloc(AGENT_V2_LEN, false)`, then `migrate_v1_agent_bytes` writes
   `107..109 = existing_constraints.to_le_bytes()`, `109..117 = created_at`,
   `117 = bumped`. `existing_constraints` is validated
   `<= MAX_CONSTRAINTS (16)` before any write. Every one of the 118 bytes is
   either written or provably preserved from the v1 record — there is no path
   where the new region can expose uninitialized memory. (The runtime also
   zero-fills extended account data; the code does not depend on that, which is
   why `zero_init = false` is safe here.)
2. **Reading happens before writing, so a rejected migration is a no-op** — the
   owner/discriminator/length checks all occur before `realloc`.
3. **Anchor cannot panic on the size mismatch**: a 116-byte account is never
   deserialized as `Account<Agent>` — this instruction deliberately takes an
   `UncheckedAccount` and does raw, bounds-checked byte surgery. For any other
   path, Anchor returns an error (`AccountDidNotDeserialize`) rather than
   panicking. The read layer is length-tolerant by design (`lib/equxi-layout.js`
   selects the layout from the account length; `tests/unit/layout.test.ts` pins
   both).
4. **Rent is funded before growth** (`required - current` transferred to the
   account), so the account is rent-exempt at 118 bytes the moment it grows.

Evidence: `programs/equxi/src/instructions/migrate_agent.rs` (handler +
`migrate_v1_agent_bytes` + its unit tests asserting byte-for-byte preservation),
plus the live migration recorded in `TEST-RESULTS.md`.

---

## 2. State invariants and reentrancy — PASS; one defense-in-depth patch proposed

### 2a. The vault invariant holds inductively

`vault.lamports == rent_exempt_min + (total_slashed − total_compensated)`

- `execute_slash`: moves exactly `slash_amount` `bond → vault`, then
  `vault.total_slashed = checked_add(slash_amount)` and
  `bond.amount = checked_sub(slash_amount)`; over-seizure is blocked by
  `require!(bond.amount >= slash_amount)`; `slash_amount > 0` required.
- `compensate_victim`: moves exactly `amount` `vault → victim`, gated by
  `amount <= slash_record.amount` (a slash is never over-paid) **and**
  `amount <= vault.available()` where `available = total_slashed.saturating_sub(total_compensated)`;
  `total_compensated = checked_add(amount)`; the record is marked
  `compensated = true` (double-pay blocked by
  `constraint = !slash_record.compensated`).
- The `slash_record` PDA is seeded with the *passed* agent key
  (`[b"slash", agent.key(), nonce]`) with `bump = slash_record.bumped`, so the
  record↔agent pairing is enforced by derivation, not by a field check.
- Both mutations are a single atomic instruction: any failed `require!` or
  `checked_*` rolls back the lamport moves too.

The on-chain rehearsal independently asserts this on live devnet: vault
`+0.2000` on slash, victim `+0.2000` on payout, vault back to rent-exempt,
`total_slashed − total_compensated == 0` (13/13, `TEST-RESULTS.md`).

### 2b. Overflow/underflow: bookkeeping is checked; the raw lamport moves are unguarded but unreachable-by-invariant

The recorded-value arithmetic uses `checked_add`/`checked_sub` throughout
(`execute_slash.rs:90,103,106`; `compensate_victim.rs:70`). The two raw lamport
mutations (`execute_slash.rs:66–67`, `compensate_victim.rs:62–63`) are plain
`+=`/`-=` — SBF release builds do not panic on overflow, so a shortfall would
wrap rather than abort.

That cannot happen today: every instruction that moves lamports out of the bond
also decrements `bond.amount`, and `create_bond`/`top_up_bond` keep
`bond.lamports == rent_exempt + bond.amount` (rent-exempt accounts cannot be
drained below their rent minimum, and both accounts here are PDAs owned by this
program). So `bond.lamports >= amount >= slash_amount` always holds when the
guard passes. **This is a hardening, not a fix** — and it is intentionally not
applied here, because the deployed v4 program is byte-verified against this
source, and silently changing the source would break that claim until a v5
upgrade is performed. Proposed patch for the next upgrade:

```rust
// in execute_slash.rs, immediately after the recorded-amount guard
require!(
    ctx.accounts.bond.amount >= slash_amount,
    EquxiError::InsufficientBond
);

// Defense in depth: every instruction keeps lamports and `amount` in lockstep,
// but the transfer below is raw u64 arithmetic (release builds wrap silently on
// underflow), so cross-check the physical balance before moving anything.
require!(
    ctx.accounts.bond.to_account_info().lamports() >= slash_amount,
    EquxiError::InsufficientBond
);
```

Deploy path to make it real: `anchor build` → `anchor keys sync` check → upgrade
with the upgrade authority → byte-verify against the CI artifact → re-run the
17-test on-chain suite and the refusal rehearsal. Until then, the deployed
program is correct by invariant, not by check.

### 2c. The unbonding gate blocks same-slot withdrawal

`withdraw_bond` delegates the entire decision to a pure function,
`ensure_withdrawable(now, expires_at)`: `now < expires_at` → `BondNotExpired`;
`now < expires_at + 7 days` → `BondInUnbondingPeriod`; with `saturating_add` so
an absurd expiry fails *closed* (never opens early). The success branch cannot be
reached from an integration test (a validator clock cannot move a week), so the
unit tests pin every boundary second; the deployed program's refusal was
re-proven live on 2026-10-04 (`BondInUnbondingPeriod`, 7/7). There is also no
"pending slash" state to race: a slash either exists on chain already (and any
exit still waits out the window) or it does not exist at all.

### 2d. Reentrancy: structurally impossible as posed

Solana has no cross-program reentrancy into the same instruction except via
self-CPI — and this program performs **no CPI of any kind except three
`SystemProgram::transfer` calls** (grep evidence above). The vault is an
`Account<Vault>` PDA seeded `[b"vault"]` and owned by the program; the only code
that can debit it is `compensate_victim`, which requires the admin signer, a
non-compensated record, and the availability checks above. A CPI from another
program would re-enter as a *new* instruction and hit exactly the same signer and
account constraints. There is no path by which an attacker re-enters mid-flight.

---

## 3. Meteora CPI graduation trust — premise mismatch; documentation corrected

**The requested property does not exist, and nothing can spoof it.** There is no
"graduation" instruction in the program and no Meteora CPI. The bond was funded
the same way every bond is: `create_bond` (which requires the *agent owner's*
signature — this closes the earlier hole where anyone could occupy an agent's
bond PDA) or `top_up_bond`. A wallet that funds a bond is not spoofing anything:
bonding is permissionless by design, and the amount is verified by the program.

What *is* claimed — "these lamports came from a DBC graduation" — is an
**off-chain, evidenced** claim, and that is the honest shape for it: the launch
page and `meteora-launch/README.md` link every transaction (config → pool → buy →
migrate → claims → unwrap → `create_bond`), and `launch-state.json` records the
migration tx and the 69,798,785 lamports claimed. That trail is verifiable by any
judge; an on-chain attestation would require a new instruction (e.g. verifying a
cp-amm vault via CPI or accepting a signed attestation PDA), which is explicitly
out of scope before Oct 12 — and should be stated as such, not glossed.

**Two stale claims were fixed in this pass** (`meteora-launch/README.md`):

- it said later top-ups "need a program instruction that does not exist yet" —
  `top_up_bond` now exists and is **live** (upgrade tx `QsbAk8qw…`, slot
  507402154), keeping `bond.amount` equal to the collateral held;
- it said "the 7-day unbonding window … is not deployed yet" — it **is**
  (upgrade tx `5tK2dMyR…`, slot 507390281, byte-verified), and the refusal was
  re-proven live.

---

## 4. Panta sanitization and attribution — handling verified; two hardenings applied

### 4a. Error handling: no empty payload can mask an anomaly

`api/markets.js` (a plain Vercel Node function — no Next.js, no proxy):

- transport failure → thrown, surfaced as `502 "Panta API unreachable: …"`;
- `!response.ok` → Panta's own `code`/`message` kept; status mapped honestly —
  `RATE_LIMITED` → `429`, `INVALID_MARKET_PARAMS` → `400`, rejected key → `502`
  (our config fault, not the caller's);
- unconfigured key → **labelled** `200 {configured: false, note: …}`, never a
  silent empty list;
- **applied fix:** a `200` whose body has no `items` array now throws
  `502 "Panta API returned a malformed market list"` instead of quietly
  producing an empty registry. Test added; unit suite now **163 passing**.

### 4b. Attribution: server-side and fail-closed; one client-side binding added

Panta verifies attribution itself — `POST /trades/` is fail-closed
(`TX_NOT_FOUND`, `TX_FAILED`, `TX_MISMATCH`, `TX_FEE_MISMATCH`) and idempotent per
signature. Our CLI cannot forge that; it can only mis-label its own call, so the
checks that matter are (a) the market it thinks it built for and (b) the quote it
builds from. **Applied fix:** `panta-agent-market.js buy` now refuses to build
when the quote echoes a different `marketId` than the operator named. The
`userId`/`clientOrderId` attribution fields are informational; the on-chain
signature is the identity Panta verifies.

**Premise correction:** there is no "operator agent PDA" to compare against —
market identity is `marketId` (the event PDA Panta returns at register), and the
agent lives in the question/resolution text. Binding to a *specific Equxi agent
account* on-chain would require the program to attest the market, which is the
same (deliberately deferred) attestation piece as §3.

---

## 5. Solami / frontend — not applicable; the real frontend path passes

**5a. There is no telemetry to review.** Solami was not entered, and no
Yellowstone gRPC, Mirage WebSocket, or streaming ingestion exists anywhere in the
sources (grep evidence in §0). No claim about real-time stream recovery should be
made in any submission; it is not a hardening gap, it is a different product.

**5b. The REST frontend is XSS-clean:**

- `explorer.js` routes **every** interpolated value through `esc()` (66 call
  sites; escapes `& < > " '`), including inside `href` attributes
  (`addrLink`, the "Raw JSON" link, the copy-link payload) and grades;
  `document.title` is assigned as text, not markup. Verified by reading
  `renderDetail` and `addrLink` end to end.
- `landing.js` contains **no `innerHTML` at all** — values are written with
  `textContent`, and CI fails the build if `innerHTML =` ever appears there.
- `api/badge.js` XML-escapes everything before it reaches SVG markup; the JSON
  endpoints set `application/json`. Agent names and slash reasons are
  attacker-controlled strings, and none of them can become markup on any surface.

---

## 6. Applied vs proposed changes

**Applied in this pass** (committed): `api/markets.js` malformed-list guard +
test; `panta-agent-market.js` quote/market echo guard; `meteora-launch/README.md`
stale-claims correction.

**Proposed, deploy-gated** (exact patch in §2b): `execute_slash.rs` lamport
cross-check. Deliberately not applied: the deployed v4 program is byte-verified
against the current source, and the check guards a state that the invariants in
§2a currently make unreachable. Applying it means a v5 upgrade + byte
re-verification + re-running the on-chain suite before any claim can reference it.

## 7. Limits of this audit

- Source-level review only; no external auditor, no fuzzing, no formal methods.
- The deployed program is v4; source and deployment match today and must be kept
  that way.
- Claims about Solami or real-time telemetry cannot be audited because they do
  not exist — do not submit them.
