# DEMO-RUNBOOK.md — recording the 75-second Equxi demo

Everything in this file was rehearsed end-to-end on **Oct 4, 2026** against
live devnet, using the recovered admin keypair. Measured wall times are from
those rehearsals. Nothing here depends on the video being recorded first.

## The two rules

1. **Never display key material.** The scripts read the admin keypair silently.
   Do not `cat`, `echo`, or open `C:\Users\sithu\.config\solana\equxi-admin.json`
   on camera, and keep it out of the repo forever. If a take shows the file's
   *name* in a command line, that is fine; its *contents* are not.
2. **Every segment is independently re-runnable.** Each run registers a fresh
   agent with a timestamped name, so repeated takes never collide, and the
   vault assertions compare deltas, so a demo does not need chain state reset.

## Pre-flight (60 seconds, before pressing record)

```bash
cd C:/Users/sithu/freebuff/equxi

# 1. authority sanity — both lines must print the same 44-char key
node prove-compensation.js --who
#   required authority  : 3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR
#   expected on devnet  : 3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR

# 2. runway — needs > 1 SOL; currently ~22.8 SOL (≈ 35 money-path takes)
wsl.exe -e bash -lc "solana balance 3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR --url devnet"

# 3. artifacts
ls sdk/dist/index.js          # SDK build (npm run build:sdk to rebuild)
node --check prove-compensation.js && node --check prove-unbonding.js

# 4. live site (browser segments)
curl -sI https://equxi.sithunyein.com/api/trust | head -1
curl -sI https://equxi.sithunyein.com/api/badge | head -1
```

Keypair path used in every command below:
`C:/Users/sithu/.config/solana/equxi-admin.json`

## Segment map (75s shot list from COLOSSEUM-SUBMISSION.md §8)

| Slot | Screen | Action | Measured |
|------|--------|--------|----------|
| 0:00–0:06 | Landing | https://equxi.sithunyein.com | — |
| 0:06–0:16 | Explorer | Augur agent, expired + slash ledger | — |
| 0:16–0:24 | Explorer | score ledger / registry | — |
| 0:24–0:40 | Terminal | `prove-compensation.js` full money path | **6.6s, 13/13 PASS** |
| 0:40–0:50 | Terminal | `prove-unbonding.js` refusal | **7.3s, 7/7 PASS** |
| 0:50–1:02 | launch.html | EAGT launch, grade A / 92 | — |
| 1:02–1:10 | Browser | `/api/trust` JSON + `/api/badge` SVG | — |
| 1:10–1:15 | Close | — | — |

## Segment 3 — the money path (0:24)

```bash
node prove-compensation.js C:/Users/sithu/.config/solana/equxi-admin.json
```

What the camera must catch, in order:

- `[2/4] execute_slash` → `vault grew by exactly the slash amount — delta 0.2000 SOL`
- `slash moved exactly the slashed amount out of the bond — 0.5012 SOL -> 0.3012 SOL`
- `[3/4] compensate_victim` → `victim received exactly the payout — delta 0.2000 SOL`
- `deployed /api/trust reports the compensation`
- Final line: **`All assertions passed — the money moved.`**

Cost per take: 0.5 SOL locked in the bond + 0.2 SOL slashed into the vault and
paid out to a fresh victim + fees. The bond stays on-chain (it is the agent's
collateral); nothing is refunded.

## Segment 4 — the refusal (0:40)

```bash
node prove-unbonding.js C:/Users/sithu/.config/solana/equxi-admin.json
```

What the camera must catch, in order:

- `lock has expired` and `bond is inside the unbonding window, not yet withdrawable`
- `refusal is BondInUnbondingPeriod, not BondNotExpired` — the lock really did
  expire; the program still refuses
- `bond still active`, `recorded amount unchanged — 100000000`,
  `collateral still in the account — 0.1012 SOL`
- Final line: **`All assertions passed — the collateral could not walk away.`**

Cost per take: 0.1 SOL bond + fees (≈ 0.1012 SOL locked).

Both scripts print `+n.ns` wall-clock stamps per line, which makes cutting the
clip to the shot list trivial in post.

## Fallbacks

- **Public RPC slow / 429s.** Both scripts accept `EQUXI_RPC`:
  `EQUXI_RPC=<devnet-url> node prove-compensation.js …`. The scripts default to
  `https://api.devnet.solana.com`. (Ask RPC Fast for their devnet endpoint when
  the Focus plan lands; then this becomes the recommended setting.)
- **A take dies mid-way (network, keychain prompt).** Fix nothing, rerun the
  exact same command — fresh agents are generated, the vault self-balances, and
  the previous partial run leaves no state the next one trips over.
- **`ABORT: this key is not the config admin`.** You passed the wrong keypath;
  use the exact path above.
- **`BondNotExpired` appears instead of `BondInUnbondingPeriod` on take N.**
  Clock skew; just rerun (the script also polls up to 15s for expiry before
  attempting the withdrawal, so this should not happen).
- **Insufficient SOL.** Top up the admin address (see balances above); the
  operator/deployer key `DWfUjm4N…` holds ~12 SOL if you want to sweep.

## Terminal & screen hygiene for the take

- Windows Terminal, 14–16 pt, dark theme; `cls` before each terminal segment.
- Set a window title per segment (`title MONEY PATH` / `title REFUSAL`).
- Mute notifications (Focus Assist) — devnet tx signatures are long and any
  toast covers them.
- 1920×1080 capture, browser zoom 100%.
- Do the terminal segments against a clean shell; `cd C:/Users/sithu/freebuff/equxi`
  is the only setup needed.

## After the recording

1. Upload the video (YouTube unlisted or Loom) and paste the URL into the
   Colosseum submission form (main track).
2. Then file the sidetracks in this order: CertiK (security review packet is
   `CERTIK-BRIEF.md`), Meteora DBC (`launch.html` state), Adevar
   (`ADEVAR-APPLICATION.md`), Panta, RPC Fast.
3. The per-track status lives in `TRACK-READINESS.md`; the form answers were
   drafted alongside this runbook in prior sessions. Rehearsal evidence from
   Oct 4: money path take 2 tx `2n8SSBU2EFqbrH6s2cZw9AQNWXT5G4rzqAgo2GkGzcT64P4UJ6wQ24igWZHCkeinXkobeCLKf6D1YSgQjmF9fSUu`,
   refusal take tx `4kLUuNEy4eguKiFjFnnmw7QuaPB18aNStA73A8vsHiPTLpWVdcKpf9sBNgRpQhemooASosVvPYN1vzdB2pPD3Dc`.

## Known-safe state as of the last rehearsal

- Program `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc` (v4) live on devnet.
- `prove-compensation.js`: 13/13 PASS, 6.6s — including the deployed
  `/api/trust` read-back against https://equxi.sithunyein.com.
- `prove-unbonding.js`: 7/7 PASS, 7.3s — refusal error `BondInUnbondingPeriod`
  (6004), explicitly distinct from `BondNotExpired`.
- Vault ends each take rent-exempt; `totalSlashed == totalCompensated`.
