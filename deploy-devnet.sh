#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Configuring for devnet ==="
solana config set --url devnet

echo "=== Airdropping SOL ==="
solana airdrop 2 || { echo "Faucet rate limited. Try again in 8 hours or use https://faucet.solana.com"; exit 1; }

echo "=== Deploying program ==="
solana program deploy "$DIR/target/deploy/equxi.so"

PROG_ID=$(solana-keygen pubkey "$DIR/target/deploy/equxi-keypair.json")
echo "=== Program deployed: $PROG_ID ==="
echo "Explorer: https://explorer.solana.com/address/$PROG_ID?cluster=devnet"
