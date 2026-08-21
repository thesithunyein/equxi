#!/bin/bash
set -e
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Solana ==="
solana --version
solana-keygen new --no-bip39-passphrase --force
solana config set --url devnet

echo "=== Airdrop ==="
solana airdrop 5 || solana airdrop 2 || solana airdrop 1
solana balance

echo "=== Anchor CLI ==="
cargo install --version 0.30.1 anchor-cli
export PATH="$HOME/.cargo/bin:$PATH"
anchor --version

echo "=== Build ==="
cd /mnt/c/Users/sithu/freebuff/equxi
rm -f programs/equxi/Cargo.lock
anchor build

echo "=== Program ID ==="
PROGRAM_ID=$(solana-keygen pubkey target/deploy/equxi-keypair.json)
echo "Program ID: $PROGRAM_ID"

echo "=== Update IDs ==="
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" programs/equxi/src/lib.rs
sed -i "s/equxi = \"[^\"]*\"/equxi = \"$PROGRAM_ID\"/" Anchor.toml

echo "=== Rebuild ==="
anchor build

echo "=== Deploy ==="
anchor deploy --provider.cluster devnet

echo "=== Done ==="
solana account $PROGRAM_ID
echo ""
echo "✅ DEPLOYED! Program ID: $PROGRAM_ID"
echo "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "$PROGRAM_ID" > /mnt/c/Users/sithu/freebuff/equxi/PROGRAM_ID.txt
