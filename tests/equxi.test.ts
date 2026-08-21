import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { BN } from "bn.js";

describe("equxi", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Equxi;
  const operator = provider.wallet;

  let agentPDA: PublicKey;
  let agentBump: number;
  let bondPDA: PublicKey;
  let bondBump: number;

  const agentName = "TestTrader";
  const bondAmount = new BN(5_000_000_000); // 5 SOL
  const lockDuration = new BN(30 * 24 * 60 * 60); // 30 days

  before(async () => {
    // Derive PDAs
    [agentPDA, agentBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), operator.publicKey.toBuffer(), Buffer.from(agentName)],
      program.programId
    );

    [bondPDA, bondBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      program.programId
    );
  });

  it("Registers an agent", async () => {
    await program.methods
      .registerAgent(agentName, { trader: {} })
      .accounts({
        agent: agentPDA,
        operator: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const agent = await program.account.agent.fetch(agentPDA);
    expect(agent.name).to.equal(agentName);
    expect(agent.trustScore).to.equal(50);
    expect(agent.status).to.deep.equal({ active: {} });
  });

  it("Creates a bond", async () => {
    await program.methods
      .createBond(bondAmount, lockDuration)
      .accounts({
        bond: bondPDA,
        agent: agentPDA,
        operator: operator.publicKey,
        owner: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const bond = await program.account.bond.fetch(bondPDA);
    expect(bond.amount.toString()).to.equal(bondAmount.toString());
    expect(bond.isActive).to.be.true;
  });

  it("Adds a spend limit constraint", async () => {
    const [constraintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraint"), agentPDA.toBuffer(), Buffer.from("spendLimit")],
      program.programId
    );

    await program.methods
      .addConstraint(
        { spendLimit: {} },
        {
          maxAmount: new BN(500_000_000_000), // 500 SOL
          maxPerPeriod: new BN(0),
          periodSeconds: new BN(0),
          timelockSeconds: new BN(0),
          allowedPrograms: Array(8).fill(PublicKey.default),
        }
      )
      .accounts({
        constraint: constraintPDA,
        agent: agentPDA,
        owner: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const constraint = await program.account.constraint.fetch(constraintPDA);
    expect(constraint.isEnforced).to.be.true;
  });

  it("Executes slashing", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), new BN(timestamp).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .executeSlash("Violated spend limit", new BN(1_000_000_000)) // 1 SOL
      .accounts({
        agent: agentPDA,
        bond: bondPDA,
        slashRecord: slashPDA,
        owner: operator.publicKey,
        authority: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const bond = await program.account.bond.fetch(bondPDA);
    expect(bond.amount.toString()).to.equal("4000000000"); // 4 SOL remaining
  });

  it("Fetches agent data", async () => {
    const agent = await program.account.agent.fetch(agentPDA);
    expect(agent.owner.toString()).to.equal(operator.publicKey.toString());
  });
});
