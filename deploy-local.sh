#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Configuring for localhost ==="
solana config set --url localhost

echo "=== Starting test validator ==="
solana-test-validator --reset --quiet &
VALIDATOR_PID=$!
sleep 8

echo "=== Airdropping 10 SOL ==="
solana airdrop 10

echo "=== Deploying program ==="
solana program deploy /mnt/c/Users/sithu/freebuff/equxi/target/deploy/equxi.so

PROG_ID=$(solana-keygen pubkey target/deploy/equxi-keypair.json)
echo "=== Verifying deployment ==="
solana program show $PROG_ID --url localhost

echo "=== SUCCESS — Program deployed to localhost ==="
kill $VALIDATOR_PID 2>/dev/null
