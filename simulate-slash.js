// Simulate the slash transaction to see the real error
const { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } = require('@solana/web3.js');

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ');
const connection = new Connection(RPC, 'confirmed');

// Known addresses from the user's wallet
const WALLET = new PublicKey('3zpsbtuS6qjgTVqYnXt3R59WgQceaDC2CGp9zgxDMsiR');
const AGENT_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from('agent'), WALLET.toBuffer(), Buffer.from('Augur')], PROGRAM_ID
)[0];
const CONFIG_PDA = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];
const BOND_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from('bond'), AGENT_PDA.toBuffer()], PROGRAM_ID
)[0];

// Read config to get total_slashed
async function run() {
  console.log('=== Slash Transaction Debug ===');
  console.log('Wallet:', WALLET.toString());
  console.log('Agent PDA:', AGENT_PDA.toString());
  console.log('Config PDA:', CONFIG_PDA.toString());
  console.log('Bond PDA:', BOND_PDA.toString());

  // Read config
  const configInfo = await connection.getAccountInfo(CONFIG_PDA);
  if (!configInfo) { console.log('ERROR: Config not found!'); return; }
  const data = configInfo.data;
  
  // Config layout: disc(8) + admin(32) + total_agents(8) + total_bonds(8) + total_slashed(8)
  const totalAgents = Number(data.readBigUInt64LE(40));
  const totalBonds = Number(data.readBigUInt64LE(48));
  const totalSlashed = Number(data.readBigUInt64LE(56));
  console.log('Config - agents:', totalAgents, 'bonds:', totalBonds, 'slashed:', totalSlashed);

  // Derive slash record PDA
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(totalSlashed));
  const slashRecordPDA = PublicKey.findProgramAddressSync(
    [Buffer.from('slash'), AGENT_PDA.toBuffer(), nonceBuf], PROGRAM_ID
  )[0];
  console.log('Slash Record PDA:', slashRecordPDA.toString());
  console.log('Nonce (total_slashed):', totalSlashed);

  // Compute discriminator for execute_slash
  const crypto = require('crypto');
  const disc = crypto.createHash('sha256').update('global:execute_slash').digest().slice(0, 8);
  console.log('Discriminator:', disc.toString('hex'));

  // Build instruction data: disc(8) + reason_len(4) + reason + amount(8)
  const reason = 'Testing slash';
  const reasonBuf = Buffer.from(reason);
  const reasonLenBuf = Buffer.alloc(4);
  reasonLenBuf.writeUInt32LE(reasonBuf.length);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(100000000)); // 0.1 SOL
  const ixData = Buffer.concat([disc, reasonLenBuf, reasonBuf, amountBuf]);
  console.log('Instruction data:', ixData.toString('hex'));
  console.log('Instruction data length:', ixData.length);

  // Build transaction
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: CONFIG_PDA, isSigner: false, isWritable: false },
      { pubkey: AGENT_PDA, isSigner: false, isWritable: true },
      { pubkey: BOND_PDA, isSigner: false, isWritable: true },
      { pubkey: slashRecordPDA, isSigner: false, isWritable: true },
      { pubkey: WALLET, isSigner: true, isWritable: true },   // authority
      { pubkey: WALLET, isSigner: false, isWritable: false },  // owner
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: ixData,
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = WALLET;
  tx.add(ix);

  // Simulate via RPC directly
  console.log('\n=== Simulating via RPC ===');
  const serialized = tx.serialize({ requireAllSignatures: false });
  const simResp = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'simulateTransaction',
      params: [serialized.toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }]
    })
  });
  const sim = await simResp.json();
  if (sim.result && sim.result.value) {
    console.log('Simulation err:', sim.result.value.err || 'none');
    if (sim.result.value.logs) {
      console.log('\nLogs:');
      sim.result.value.logs.forEach(l => console.log(' ', l));
    }
  } else {
    console.log('Raw response:', JSON.stringify(sim).slice(0, 500));
  }
}

run().catch(e => console.error('Error:', e.message));
