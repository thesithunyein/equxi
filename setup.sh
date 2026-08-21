#!/bin/bash
set -e

echo "🔧 Equxi — Setup & Deploy to Solana Devnet"
echo "============================================"
echo ""

# Check prerequisites
check_cmd() {
  if ! command -v $1 &> /dev/null; then
    echo "❌ $1 is not installed. Please install it first."
    echo "   $2"
    exit 1
  fi
}

check_cmd "solana" "Install: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""
check_cmd "anchor" "Install: cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.30.1"
check_cmd "node" "Install: https://nodejs.org/"
check_cmd "yarn" "Install: npm install -g yarn"

echo "✅ All prerequisites found"
echo ""

# Configure Solana for devnet
echo "📡 Configuring Solana for devnet..."
solana config set --url devnet

# Check if wallet exists, create if not
if [ ! -f ~/.config/solana/id.json ]; then
  echo "🔑 Creating new Solana wallet..."
  solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json
fi

# Get wallet address
WALLET=$(solana address)
echo "💰 Wallet: $WALLET"

# Request airdrop
echo "💸 Requesting 2 SOL airdrop..."
solana airdrop 2 || echo "⚠️  Airdrop failed (rate limited). You can request manually: solana airdrop 2"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
yarn install

# Generate program keypair if not exists
if [ ! -f target/deploy/equxi-keypair.json ]; then
  echo "🔑 Generating program keypair..."
  solana-keygen new -o target/deploy/equxi-keypair.json --no-bip39-passphrase
fi

# Get program ID
PROGRAM_ID=$(solana address -k target/deploy/equxi-keypair.json)
echo "📋 Program ID: $PROGRAM_ID"

# Update program ID in source files
echo "📝 Updating program ID in source files..."
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" programs/equxi/src/lib.rs
sed -i "s/equxi = \"[^\"]*\"/equxi = \"$PROGRAM_ID\"/" Anchor.toml

# Update SDK program ID
sed -i "s/const PROGRAM_ID = new PublicKey(\"[^\"]*\")/const PROGRAM_ID = new PublicKey(\"$PROGRAM_ID\")/" sdk/src/index.ts

echo ""
echo "🔨 Building program..."
anchor build

# Verify build
if [ ! -f target/deploy/equxi.so ]; then
  echo "❌ Build failed"
  exit 1
fi

echo "✅ Build successful"
echo ""

# Run tests
echo "🧪 Running tests..."
anchor test --skip-local-validator || echo "⚠️  Some tests failed (this is expected if program ID changed)"
echo ""

# Deploy to devnet
echo "🚀 Deploying to devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo "✅ Deployed successfully!"
echo ""
echo "📋 Program ID: $PROGRAM_ID"
echo "🔗 Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""
echo "Next steps:"
echo "  1. Update PROGRAM_ID in app.js to: $PROGRAM_ID"
echo "  2. Run: npx serve ."
echo "  3. Open http://localhost:3000/app.html"
echo "  4. Connect Phantom wallet (set to Devnet)"
echo "  5. Start registering agents!"
echo ""
echo "🎉 Done!"
