#!/bin/bash
#
# Upgrade the devnet deployment to v0.2 and migrate its on-chain state.
#
# Two things have to happen, in this order, and neither is reversible by
# redeploying code alone:
#
#   1. the program at the existing address is replaced with the v0.2 build, and
#   2. every agent still on the 116-byte v0.1 layout is grown in place, and the
#      escrow vault that v0.1 never created is created.
#
# Between 1 and 2 the deployment is in a state where the program cannot read its
# own agent accounts, so `migrate.js` runs immediately after the upgrade, in the
# same command. Run `node migrate.js --dry-run` first to see what it will touch.
#
# Requirements: the D7akK... program keypair and the upgrade-authority keypair.
# Override paths with the environment variables below.
#
#   EQUXI_SOLANA   solana CLI                (default: found on PATH)
#   EQUXI_SBF      cargo-build-sbf           (default: found on PATH)
#   EQUXI_SO       the built program         (default: /home/sithu/equxi-v2-out/equxi.so)
#   EQUXI_KEYPAIR  upgrade authority keypair (default: ~/.config/solana/id.json)
#   EQUXI_PROGRAM_KEYPAIR  program keypair   (default: the equxi-build copy)
#   EQUXI_ROLLBACK the previously deployed   (default: the equxi-build v0.1 copy)
#                  v0.1 build, used to roll back
#
set -euo pipefail

PROGRAM_ID="D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc"
PROGRAM_DATA="HQHAKxNdgE6gxFHtGon7bJhqWTKCCXfypWpUuV1GDh7x"
EQUXI_SOLANA="${EQUXI_SOLANA:-solana}"
EQUXI_SBF="${EQUXI_SBF:-cargo-build-sbf}"
EQUXI_SO="${EQUXI_SO:-/home/sithu/equxi-v2-out/equxi.so}"
EQUXI_KEYPAIR="${EQUXI_KEYPAIR:-$HOME/.config/solana/id.json}"
EQUXI_PROGRAM_KEYPAIR="${EQUXI_PROGRAM_KEYPAIR:-/home/sithu/equxi-build/target/deploy/equxi-keypair.json}"
EQUXI_ROLLBACK="${EQUXI_ROLLBACK:-/home/sithu/equxi-build/target/deploy/equxi.so}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

sol() { "$EQUXI_SOLANA" "$@" --url devnet; }

echo "=== Pre-flight ==="
[ -f "$EQUXI_KEYPAIR" ] || { echo "Missing upgrade-authority keypair: $EQUXI_KEYPAIR"; exit 1; }
[ -f "$EQUXI_PROGRAM_KEYPAIR" ] || { echo "Missing program keypair: $EQUXI_PROGRAM_KEYPAIR"; exit 1; }

# Build if there is no artifact yet. cargo-build-sbf is used directly rather
# than `anchor build` on purpose: `anchor build` writes its own program keypair
# and `anchor keys sync` rewrites declare_id to match it, which would produce a
# binary that refuses to run at D7akK... (Anchor checks declare_id against the
# executing program id). Building from this source keeps declare_id correct.
if [ ! -f "$EQUXI_SO" ]; then
  echo "No artifact at $EQUXI_SO — building..."
  ( cd "$REPO_DIR" && "$EQUXI_SBF" --manifest-path programs/equxi/Cargo.toml \
      --sbf-out-dir "$(dirname "$EQUXI_SO")" )
fi
SO_SIZE=$(stat -c %s "$EQUXI_SO")
echo "artifact      $EQUXI_SO ($SO_SIZE bytes)"

# Anchor refuses to run at any address other than the one compiled in, so a
# build whose declare_id drifted -- which is what `anchor build` produces after
# `anchor keys sync` generates a fresh keypair -- would deploy cleanly and then
# reject every instruction. Check the bytes rather than trusting the build.
( cd "$REPO_DIR" && node -e '
const fs = require("fs");
const layout = require("./lib/equxi-layout.js");
const so = fs.readFileSync(process.argv[1]);
const id = Buffer.from(layout.bs58Decode(layout.PROGRAM_ID));
if (!so.includes(id)) {
  console.error(`artifact does not declare ${layout.PROGRAM_ID}; it would deploy ` +
    `and then reject every instruction`);
  process.exit(1);
}
console.log(`declares     ${layout.PROGRAM_ID}`);
' "$EQUXI_SO" )

# Verify the deployed bytes are the v0.1 build we think they are. If the chain
# does not match the rollback artifact, upgrading would destroy a deployment we
# cannot restore, so stop and say so instead of guessing.
echo -n "rollback      "
"$EQUXI_SOLANA" account "$PROGRAM_DATA" --url devnet --output json > /tmp/equxi-programdata.json
node -e '
const fs = require("fs");
const chain = JSON.parse(fs.readFileSync("/tmp/equxi-programdata.json", "utf8"));
// ProgramData is a 45-byte header followed by the program, which is written
// into the account the previous deploy allocated. Any surplus is zero padding,
// so the chain will be *longer* than the binary that was deployed to it.
const region = Buffer.from(chain.account.data[0], "base64").subarray(45);
const backup = fs.readFileSync(process.argv[1]);
const head = region.subarray(0, backup.length);
const padding = region.subarray(backup.length);
const paddingIsZero = padding.every((b) => b === 0);
if (!head.equals(backup) || !paddingIsZero) {
  console.error(`on-chain code does not match the rollback artifact ` +
    `(program ${head.length}/${backup.length} bytes, padding ` +
    `${paddingIsZero ? "zero" : "NOT zero"}) — refusing to upgrade something ` +
    `we could not restore`);
  process.exit(1);
}
console.log(`verified: on-chain program matches the v0.1 rollback build ` +
  `(${backup.length} bytes + ${padding.length} bytes of zero padding)`);
' "$EQUXI_ROLLBACK"

# The upgrade writes the new program into a rent-funded buffer first, then moves
# it into ProgramData and extends that account if the program grew. Both are
# paid out of the authority's balance, so check it before the loader does.
AUTH_PUBKEY=$("$EQUXI_SOLANA" address -k "$EQUXI_KEYPAIR")
"$EQUXI_SOLANA" account "$AUTH_PUBKEY" --url devnet --output json > /tmp/equxi-authority.json
node -e '
const fs = require("fs");
const size = Number(process.argv[1]);
const held = JSON.parse(fs.readFileSync("/tmp/equxi-programdata.json", "utf8")).account.lamports;
const wallet = JSON.parse(fs.readFileSync("/tmp/equxi-authority.json", "utf8")).account.lamports;
const pubkey = process.argv[2];
// The devnet rent curve, measured against the RPC: rent(n) = 5080n + 650240.
// Two years at 3480 lamports per byte would be 6960n, but devnet charges 5080
// per byte here; the textbook number overstates the cost by ~37% and would
// make this check refuse an upgrade that would actually succeed.
const rent = (n) => 5080 * n + 650240;
const buffer = rent(size);
// The buffer is refunded into ProgramData on upgrade; if the program grew past
// what the existing account was funded for, the difference is the only part
// that does not come back.
const delta = Math.max(0, rent(size + 45) - held);
const peak = Math.max(buffer, buffer + delta - held);
const sol = (l) => (l / 1e9).toFixed(4);
console.log(`programdata   ${sol(held)} SOL of rent already committed`);
console.log(`wallet        ${sol(wallet)} SOL`);
console.log(`needs         ${sol(peak)} SOL ` +
  `(buffer ${sol(buffer)}; ${sol(delta)} of it becomes permanent programdata rent)`);
if (wallet < peak) {
  console.error(`\nNot enough SOL to write the upgrade buffer. Fund ${pubkey} with ` +
    `at least ${sol(peak - wallet + 5e6)} SOL (https://faucet.solana.com), then re-run.`);
  process.exit(1);
}
' "$SO_SIZE" "$AUTH_PUBKEY"

echo ""
echo "=== Upgrading the program ==="
"$EQUXI_SOLANA" program deploy "$EQUXI_SO" \
  --program-id "$EQUXI_PROGRAM_KEYPAIR" \
  --upgrade-authority "$EQUXI_KEYPAIR" \
  --url devnet

echo ""
echo "=== Migrating on-chain state ==="
# The program is now v0.2 but its agents are still 116 bytes. This grows each
# one, creating the vault first, and refuses to continue if any preserved field
# changed.
( cd "$REPO_DIR" && EQUXI_KEYPAIR="$EQUXI_KEYPAIR" node migrate.js )

echo ""
echo "=== Verification ==="
sol program show "$PROGRAM_ID" | head -6
curl -s https://equxi.sithunyein.com/api/trust | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const j = JSON.parse(s);
  console.log("agents", j.counts.agents, "| vault", j.vault ? "present" : "MISSING");
  console.log("warnings:", j.warnings.length ? j.warnings : "none");
});'
echo ""
echo "Done. Roll back with:"
echo "  solana program deploy $EQUXI_ROLLBACK --program-id $EQUXI_PROGRAM_KEYPAIR --upgrade-authority $EQUXI_KEYPAIR --url devnet"
