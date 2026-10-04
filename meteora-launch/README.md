# Equxi × Meteora DBC — "launch with safety escrow"

A token launch on Meteora's dynamic bonding curve that also creates the collateral behind
it. The launch graduates, the graduation proceeds that DBC lets a config route to the
creator are claimed, and those lamports are posted as an **Equxi agent's slashable bond** —
so the same transaction trail that creates the token creates the consequence for the agent
that runs it.

This is not a pitch document. Everything below ran on **devnet** on 2026-10-04, and every
step links to its transaction.

## The launch, on chain

| Step | What it is | Transaction |
|---|---|---|
| `createConfig` | DBC config: 1B supply, SOL quote, 1% base fee, **50% of trading fees to the creator**, **10% migration fee, 50% of it to the creator** | [`4UNyVwWK…`](https://explorer.solana.com/tx/4UNyVwWKsBGAeRjfdGMbjjtkoHBqJXPtxPfBMFipVVdUZvgsjmbZKyL1KxjuEiLkRFRFUzyGsFoP2UA98f3ZMstQ?cluster=devnet) |
| `createPool` | Token `EAGT` (`7qxExXZ9…`), DBC pool `GQDjSW19…`, graduation threshold **0.698 SOL** | [`5VgjsKAu…`](https://explorer.solana.com/tx/5VgjsKAuX5x4Wt8juSGjn9CJtz2CPMjsRHTAHV9FRxcHBDSz2oPw4hENtJNnYGGHqmKkPGrGq478nZ5SYq5xS32n?cluster=devnet) |
| `buy` (partial fill) | The final buy stops exactly at the threshold — DBC refuses a buy that would overshoot it. Curve: **100%** | [`63XKG1HK…`](https://explorer.solana.com/tx/63XKG1HKGGBz76paU2dS8K6MzUqQEzfNMfnLtdHc9KjCWJcWmXeA6gV1Bg7MFR9eBwqAct4VmtmiY1FakJ6DkmxB?cluster=devnet) |
| `migrateToDammV2` | **Graduation** into DAMM v2 (config `A8gMrEPJ…`, the dynamic-fee option) | [`z7k3EcSp…`](https://explorer.solana.com/tx/z7k3EcSpJJAVNJ8rkkQUP55acbWrSNV2VLgsV23HpjToWrRDfKWU2dL9rVVdv2GcMVP7KuZ5b7sQJyeBEjGwCxm?cluster=devnet) |
| `open fee account` | The wrapped-SOL account the quote fees land in — it must exist before any claim, or the token program rejects the credit | [`a3SS74ow…`](https://explorer.solana.com/tx/a3SS74ownhe3wnwUqG4Ddxp1NLwo2PuvT8WS2kucPD2MQYaTGYL4u7XC4Xfty4ng3Dh52Ge96id7rW24Ms5CLag?cluster=devnet) |
| `creatorWithdrawMigrationFee` + `partnerWithdrawMigrationFee` | The graduation proceeds: 10% of the graduated quote, split creator/partner. Wallet moved **+0.0698 SOL** | [`QsA82W9b…`](https://explorer.solana.com/tx/QsA82W9bR1GMxJLBujL6yXrkt26XQSZ8KLjsdR2TyUivLbB7EVUtjCLQd2RDjMYxqAzxreHi69MxHvpQiynavXN?cluster=devnet), [`5DeRbeU5…`](https://explorer.solana.com/tx/5DeRbeU5rjwnz2XM28pkStjmhBXUqRLuX2NiWJAka2heELWyunvwjqYigrZEqxMYsURzPwj3X38K5Agi9YqmPrn9?cluster=devnet) |
| `register_agent` | The launched token's agent on Equxi: `9CvFbUci…` | [`2coSpGkf…`](https://explorer.solana.com/tx/2coSpGkfX63Z23YioZ7U9uB3qUsewjpZpRquBvgUh66yac56ePnPiMEjAz8FzeMQKW2y9KgZh5tnL9gPrmCykp98?cluster=devnet) |
| `unwrapWSOL` | Proceeds come back as lamports so they can be handed to Equxi | [`Euu2je2L…`](https://explorer.solana.com/tx/Euu2je2Leh6iFy1Wfw1SJZ16VcQJXrHJ3YHmbE8Z2BCPo6bj5i6heEt9zxeemfJn5oETbQQNyCWMQatP6WcRs8a?cluster=devnet) |
| `create_bond` | The launch proceeds become collateral: bond `CU5R3w8D…`, **0.1 SOL** recorded | [`4EFJktKi…`](https://explorer.solana.com/tx/4EFJktKiuYgzZhLWZ63R9eAERbdtqvbccei6MgY72g7Kd8QrtKTRd5f3T2AFv8ZTbvAdtQPj8C3P7EL4WpRQx8pe?cluster=devnet) |

The result is readable through Equxi's public API with no privileged access — the agent the
launch created is graded, with the bond `locked` and `withdrawable: false`:

```
GET https://equxi.sithunyein.com/api/trust?agent=9CvFbUciyP4APMVyzjLiR2znFmMTEPNqfGAP37PDNU4J
{ "name": "EAGT", "grade": "A", "score": 92,
  "bond": { "amountSol": 0.1, "isActive": true, "locked": true, "expired": false, "withdrawable": false } }
```

## Running it

Everything is staged and resumable, because a public devnet RPC is a public devnet RPC:

```bash
cd meteora-launch && npm install

METEORA_LAUNCH_KEYPAIR=~/.config/solana/your-devnet-key.json node launch-safety-bond.js <stage>

# stages, in order:
#   status | config | pool | buy | claim-trading | migrate | claim | bond | all
```

The order matters in one place, and the chain taught us why: **`claim-trading` must run
before `migrate`.** After `migrate_to_damm_v2` the curve's fee vaults no longer exist, so
`claim_creator_trading_fee` still *reports* the fee as unclaimed
(`creator: 2,820,961` + `partner: 2,820,962` lamports on this run) but the claim itself can
no longer execute, and those lamports stay in the graduated pool.

## What this proves, and what it does not

**Proves.** A DBC launch on devnet can be configured so a share of its graduation proceeds
is claimed by the launch and posted as an agent's slashable collateral, with every step
independently verifiable on chain and the outcome visible in a public read API.

**Does not prove, stated so nobody has to discover it:**

- **The bond is at Equxi's minimum, not fully funded by the launch.** The launch
  contributed **0.0698 SOL**; the script added a **0.0302 SOL** top-up to reach Equxi's
  0.1 SOL bond minimum, and prints that split when it runs. A curve whose threshold is
  larger than this demo's 0.698 SOL removes the top-up entirely — the mechanism is the
  same, the amount is a parameter.
- **Later top-ups need a program instruction that does not exist yet.** This flow posts the
  bond and funds it *at creation*, so `bond.amount` — the number Equxi's score reads — is
  correct. Adding collateral to an *existing* bond goes through a plain SOL transfer to the
  bond account, which is slashable but not recorded in `bond.amount`. A `top_up_bond`
  instruction is the honest fix, and it is on the Equxi roadmap rather than pretended away.
- **Devnet graduation is manual.** Meteora's migration keepers run on mainnet, at the
  thresholds they publish (10 SOL, 750 USDC, …); this demo drove a deliberately tiny curve
  to completion and called the migrator itself. The DBC program id here is the same one as
  mainnet's, so the instruction path is the real one.
- **Trading fees are not part of the bond.** They are small at this size (0.0056 SOL total)
  and, as noted above, must be claimed pre-graduation; the bond is funded from the
  migration fee.
- **One devnet key ran everything**, and the Equxi deployment it talks to is the current
  devnet program (`D7akK6aU…`), whose source in this repository is newer than the
  deployment (the 7-day unbonding window described in `SPEC.md` is not deployed yet).

## What this adds to the Equxi submission

The Meteora track judges *depth of integration*, not the size of the pitch. This directory
is a working integration of the DBC stack — config construction with creator fee and
migration fee splits, pool creation with metadata, curve swaps with partial fills at the
graduation boundary, manual migration to DAMM v2, and post-graduation fee claims — plus the
Equxi side of the story, which is what makes the launch worth doing on DBC at all:
collateral that a counterparty can read before it does business with the launched agent.
