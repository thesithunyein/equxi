import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { BN } from "bn.js";

describe("equxi", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Equxi;
  const admin = provider.wallet;

  let configPDA: PublicKey;
  let agentPDA: PublicKey;
  let bondPDA: PublicKey;

  const agentName = "TestTrader";

  before(async () => {
    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), admin.publicKey.toBuffer(), Buffer.from(agentName)],
      program.programId
    );
    [bondPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      program.programId
    );
  });

  it("Initializes the program", async () => {
    await program.methods
      .initialize(admin.publicKey)
      .accounts({
        config: configPDA,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.admin.toString()).to.equal(admin.publicKey.toString());
    expect(config.totalAgents.toString()).to.equal("0");
  });

  it("Registers an agent", async () => {
    await program.methods
      .registerAgent(agentName, { trader: {} })
      .accounts({
        config: configPDA,
        agent: agentPDA,
        operator: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const agent = await program.account.agent.fetch(agentPDA);
    expect(agent.name).to.equal(agentName);
    expect(agent.trustScore).to.equal(50);
    expect(agent.status).to.deep.equal({ active: {} });

    const config = await program.account.config.fetch(configPDA);
    expect(config.totalAgents.toString()).to.equal("1");
  });

  it("Creates a bond", async () => {
    await program.methods
      .createBond(new BN(5_000_000_000), new BN(30 * 24 * 60 * 60))
      .accounts({
        config: configPDA,
        bond: bondPDA,
        agent: agentPDA,
        operator: admin.publicKey,
        owner: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const bond = await program.account.bond.fetch(bondPDA);
    expect(bond.amount.toString()).to.equal("5000000000");
    expect(bond.isActive).to.be.true;

    const config = await program.account.config.fetch(configPDA);
    expect(config.totalBonds.toString()).to.equal("1");
  });

  it("Executes slashing with nonce-based PDA", async () => {
    const config = await program.account.config.fetch(configPDA);
    const nonce = config.totalSlashed;

    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .executeSlash("Violated spend limit", new BN(1_000_000_000))
      .accounts({
        config: configPDA,
        agent: agentPDA,
        bond: bondPDA,
        slashRecord: slashPDA,
        owner: admin.publicKey,
        authority: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const bond = await program.account.bond.fetch(bondPDA);
    expect(bond.amount.toString()).to.equal("4000000000");

    const updatedConfig = await program.account.config.fetch(configPDA);
    expect(updatedConfig.totalSlashed.toString()).to.equal("1");
  });

  it("Fails to withdraw before lock expires", async () => {
    try {
      await program.methods
        .withdrawBond()
        .accounts({
          bond: bondPDA,
          agent: agentPDA,
          operator: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(err.toString()).to.include("BondNotExpired");
    }
  });

  it("Adds a spending limit constraint", async () => {
    const config = await program.account.config.fetch(configPDA);
    const nonce = Number(config.totalBonds) + 1;
    const [constraintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraint"), agentPDA.toBuffer(), new BN(nonce).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const params = {
      maxAmount: new BN(1_000_000_000),
      maxPerPeriod: new BN(5_000_000_000),
      periodSeconds: new BN(86400),
      timelockSeconds: new BN(0),
      allowedPrograms: Array(8).fill(SystemProgram.programId),
    };

    await program.methods
      .addConstraint({ spendLimit: {} }, params)
      .accounts({
        config: configPDA,
        constraint: constraintPDA,
        agent: agentPDA,
        operator: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const constraint = await program.account.constraint.fetch(constraintPDA);
    expect(constraint.isEnforced).to.be.true;
  });
});
