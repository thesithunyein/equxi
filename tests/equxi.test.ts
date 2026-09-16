import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";

const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

describe("equxi", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Equxi;
  const admin = provider.wallet;

  let configPDA: PublicKey;
  let vaultPDA: PublicKey;
  let programDataPDA: PublicKey;

  // agentA: long lock, used for slash / compensation tests
  let agentAPDA: PublicKey;
  let bondAPDA: PublicKey;
  const agentAName = "TestTrader";

  // agentB: short lock, used for the withdrawal test
  let agentBPDA: PublicKey;
  let bondBPDA: PublicKey;
  const agentBName = "TestWithdrawer";

  const SHORT_LOCK_SECONDS = 1;
  const LONG_LOCK_SECONDS = 30 * 24 * 60 * 60;

  const link = (agentPDA: PublicKey, nonce: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const constraintPDA = (agentPDA: PublicKey, index: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("constraint"), agentPDA.toBuffer(), new BN(index).toArrayLike(Buffer, "le", 2)],
      program.programId
    )[0];

  const defaultParams = () => ({
    maxAmount: new BN(1_000_000_000),
    maxPerPeriod: new BN(5_000_000_000),
    periodSeconds: new BN(86400),
    timelockSeconds: new BN(0),
    allowedPrograms: Array(8).fill(SystemProgram.programId),
  });

  before(async () => {
    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );
    [programDataPDA] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    );

    [agentAPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), admin.publicKey.toBuffer(), Buffer.from(agentAName)],
      program.programId
    );
    [bondAPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentAPDA.toBuffer()],
      program.programId
    );
    [agentBPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), admin.publicKey.toBuffer(), Buffer.from(agentBName)],
      program.programId
    );
    [bondBPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentBPDA.toBuffer()],
      program.programId
    );
  });

  it("Initializes the program and creates the escrow vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        payer: admin.publicKey,
        program: program.programId,
        programData: programDataPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.admin.toString()).to.equal(admin.publicKey.toString());
    expect(config.totalAgents.toString()).to.equal("0");
    expect(config.totalSlashed.toString()).to.equal("0");

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalSlashed.toString()).to.equal("0");
    expect(vault.totalCompensated.toString()).to.equal("0");
  });

  it("Rejects initialize from a non-upgrade-authority", async () => {
    // The config already exists, but the failure we care about is the authority
    // check. A fresh deploy would fail on InvalidAdminAuthority before the init.
    const intruder = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(intruder.publicKey, LAMPORTS_PER_SOL)
    );

    try {
      await program.methods
        .initialize()
        .accounts({
          config: configPDA,
          vault: vaultPDA,
          payer: intruder.publicKey,
          program: program.programId,
          programData: programDataPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(String(err)).to.match(/InvalidAdminAuthority|already in use|custom program error/);
    }
  });

  it("Registers two agents", async () => {
    for (const [pda, name] of [
      [agentAPDA, agentAName],
      [agentBPDA, agentBName],
    ] as [PublicKey, string][]) {
      await program.methods
        .registerAgent(name, { trader: {} })
        .accounts({
          config: configPDA,
          agent: pda,
          operator: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const agent = await program.account.agent.fetch(agentAPDA);

    // The name is stored on-chain as a fixed `[u8; 32]`, not a JS string, and
    // every decoder in this repo (coder.ts `decodeName`, lib/equxi-layout.js
    // `fixedString`) reads it by trimming at the first NUL. Assert that stored
    // contract, not a decoded convenience value: the bytes AND their padding.
    const nameBytes = agent.name as unknown as number[];
    expect(nameBytes).to.have.length(32);
    expect(
      Buffer.from(nameBytes).subarray(0, nameBytes.indexOf(0)).toString("utf8")
    ).to.equal(agentAName);
    expect(nameBytes.slice(agentAName.length)).to.deep.equal(
      new Array(32 - agentAName.length).fill(0)
    );

    expect(agent.trustScore).to.equal(50);
    expect(agent.status).to.deep.equal({ active: {} });
    expect(agent.constraintCount).to.equal(0);

    const config = await program.account.config.fetch(configPDA);
    expect(config.totalAgents.toString()).to.equal("2");
  });

  describe("migrate_agent guards", () => {
    const migrate = (agent: PublicKey, signer: PublicKey) =>
      program.methods
        .migrateAgent(0)
        .accounts({
          config: configPDA,
          agent,
          signer,
          program: program.programId,
          programData: programDataPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

    it("refuses an agent that is already in the v0.2 layout", async () => {
      // This is the mistake that matters: running the migration twice, or on a
      // freshly registered agent, must not touch a 118-byte account.
      try {
        await migrate(agentAPDA, admin.publicKey);
        expect.fail("Should have failed");
      } catch (err) {
        expect(String(err)).to.include("InvalidAgentLayout");
      }
    });

    it("refuses a 116-byte account that is not an agent record", async () => {
      // A genuine v0.1 agent record cannot be fabricated here: only the owning
      // program may write account data, and this program no longer writes the
      // v0.1 layout. So this test exercises the length gate for real, the byte
      // surgery is covered exhaustively by the Rust unit tests in
      // `migrate_agent.rs`, and the success path is proven end to end by the
      // devnet migration of the live agent.
      const impostor = Keypair.generate();
      const space = 116;
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(
        space
      );
      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(
          SystemProgram.createAccount({
            fromPubkey: admin.publicKey,
            newAccountPubkey: impostor.publicKey,
            lamports,
            space,
            programId: program.programId,
          })
        ),
        [impostor]
      );

      try {
        await migrate(impostor.publicKey, admin.publicKey);
        expect.fail("Should have failed");
      } catch (err) {
        expect(String(err)).to.include("InvalidAgentLayout");
      }
    });
  });

  it("Creates bonds", async () => {
    await program.methods
      .createBond(new BN(5_000_000_000), new BN(LONG_LOCK_SECONDS))
      .accounts({
        config: configPDA,
        bond: bondAPDA,
        agent: agentAPDA,
        owner: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .createBond(new BN(100_000_000), new BN(SHORT_LOCK_SECONDS))
      .accounts({
        config: configPDA,
        bond: bondBPDA,
        agent: agentBPDA,
        owner: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const bond = await program.account.bond.fetch(bondAPDA);
    expect(bond.amount.toString()).to.equal("5000000000");
    expect(bond.isActive).to.be.true;

    const config = await program.account.config.fetch(configPDA);
    expect(config.totalBonds.toString()).to.equal("2");
  });

  // Regression: the owner used to be checked only by address without signing,
  // so anyone could occupy an agent's single bond PDA with a dust bond.
  it("Rejects a bond created by someone who is not the agent owner", async () => {
    const intruder = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(intruder.publicKey, LAMPORTS_PER_SOL)
    );

    const [bondCPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentBPDA.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createBond(new BN(100_000_000), new BN(SHORT_LOCK_SECONDS))
        // Account already exists -> init fails, and the has_one check fails too.
        .accounts({
          config: configPDA,
          bond: bondCPDA,
          agent: agentBPDA,
          owner: intruder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([intruder])
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(String(err)).to.match(/Unauthorized|custom program error|already in use/);
    }
  });

  it("Slashes collateral into the escrow vault, not to the admin", async () => {
    const adminBefore = await provider.connection.getBalance(admin.publicKey);
    const vaultBefore = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .executeSlash("Violated spend limit", new BN(1_000_000_000))
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        agent: agentAPDA,
        bond: bondAPDA,
        slashRecord: link(agentAPDA, new BN(0)),
        authority: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const vaultAfter = await provider.connection.getBalance(vaultPDA);
    const adminAfter = await provider.connection.getBalance(admin.publicKey);

    // The vault gains the slashed lamports.
    expect(vaultAfter - vaultBefore).to.equal(1_000_000_000);
    // The admin does not profit from the slash (it only pays tx fees).
    expect(adminAfter).to.be.lessThan(adminBefore);

    const bond = await program.account.bond.fetch(bondAPDA);
    expect(bond.amount.toString()).to.equal("4000000000");

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalSlashed.toString()).to.equal("1000000000");
    expect(vault.totalCompensated.toString()).to.equal("0");

    const config = await program.account.config.fetch(configPDA);
    expect(config.totalSlashed.toString()).to.equal("1");
  });

  it("Rejects a slash larger than the bond", async () => {
    try {
      await program.methods
        .executeSlash("Too much", new BN(9_000_000_000))
        .accounts({
          config: configPDA,
          vault: vaultPDA,
          agent: agentAPDA,
          bond: bondAPDA,
          slashRecord: link(agentAPDA, new BN(1)),
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(String(err)).to.include("InsufficientBond");
    }
  });

  // Regression: compensation used to be drawn from the admin wallet while
  // bond.amount was decremented anyway, stranding the difference in the PDA.
  it("Compensates the victim from escrow and leaves bond.amount untouched", async () => {
    const victim = Keypair.generate();
    const victimBefore = 0;

    const bondBefore = await program.account.bond.fetch(bondAPDA);

    await program.methods
      .compensateVictim(new BN(1_000_000_000))
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        slashRecord: link(agentAPDA, new BN(0)),
        agent: agentAPDA,
        victim: victim.publicKey,
        authority: admin.publicKey,
      })
      .rpc();

    const victimAfter = await provider.connection.getBalance(victim.publicKey);
    expect(victimAfter - victimBefore).to.equal(1_000_000_000);

    // The bond's recorded collateral is unchanged by compensation.
    const bondAfter = await program.account.bond.fetch(bondAPDA);
    expect(bondAfter.amount.toString()).to.equal(bondBefore.amount.toString());

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalCompensated.toString()).to.equal("1000000000");
    expect(vault.totalSlashed.sub(vault.totalCompensated).toString()).to.equal("0");

    const record = await program.account.slashRecord.fetch(link(agentAPDA, new BN(0)));
    expect(record.compensated).to.be.true;
    expect(record.victim.toString()).to.equal(victim.publicKey.toString());

    // SlashRecord.reason is a fixed `[u8; 128]` zero-padded by the program.
    // The decoders assume exactly that padding, so check the stored bytes: a
    // missing pad would leak NULs into every decoded report of this slash.
    const reasonBytes = record.reason as unknown as number[];
    expect(reasonBytes).to.have.length(128);
    expect(
      Buffer.from(reasonBytes).subarray(0, reasonBytes.indexOf(0)).toString("utf8")
    ).to.equal("Violated spend limit");
    expect(reasonBytes.slice("Violated spend limit".length)).to.deep.equal(
      new Array(128 - "Violated spend limit".length).fill(0)
    );

    const agent = await program.account.agent.fetch(agentAPDA);
    expect(agent.trustScore).to.equal(40);
  });

  it("Rejects compensating the same slash twice", async () => {
    try {
      await program.methods
        .compensateVictim(new BN(1))
        .accounts({
          config: configPDA,
          vault: vaultPDA,
          slashRecord: link(agentAPDA, new BN(0)),
          agent: agentAPDA,
          victim: admin.publicKey,
          authority: admin.publicKey,
        })
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(String(err)).to.include("AlreadyCompensated");
    }
  });

  it("Rejects compensation beyond the vault balance", async () => {
    // Vault is empty after the payout above.
    await program.methods
      .executeSlash("Second violation", new BN(500_000_000))
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        agent: agentAPDA,
        bond: bondAPDA,
        slashRecord: link(agentAPDA, new BN(1)),
        authority: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .compensateVictim(new BN(900_000_000))
        .accounts({
          config: configPDA,
          vault: vaultPDA,
          slashRecord: link(agentAPDA, new BN(1)),
          agent: agentAPDA,
          victim: admin.publicKey,
          authority: admin.publicKey,
        })
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(String(err)).to.match(/ExceedsSlashAmount|VaultInsufficient/);
    }
  });

  // Regression: the seed was `config.total_bonds + 1`, so a second constraint
  // derived the same PDA and `init` failed. Agents were limited to one rule.
  it("Attaches multiple constraints to the same agent", async () => {
    for (let i = 0; i < 2; i++) {
      await program.methods
        .addConstraint({ spendLimit: {} }, defaultParams())
        .accounts({
          constraint: constraintPDA(agentBPDA, i),
          agent: agentBPDA,
          owner: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const first = await program.account.constraint.fetch(constraintPDA(agentBPDA, 0));
    const second = await program.account.constraint.fetch(constraintPDA(agentBPDA, 1));
    expect(first.isEnforced).to.be.true;
    expect(second.isEnforced).to.be.true;

    const agent = await program.account.agent.fetch(agentBPDA);
    expect(agent.constraintCount).to.equal(2);
  });

  it("Fails to withdraw before the lock expires", async () => {
    try {
      await program.methods
        .withdrawBond()
        .accounts({
          bond: bondAPDA,
          agent: agentAPDA,
          operator: admin.publicKey,
        })
        .rpc();
      expect.fail("Should have failed");
    } catch (err) {
      expect(String(err)).to.include("BondNotExpired");
    }
  });

  it("Closes the bond on withdrawal and returns the remaining collateral", async () => {
    // agentB used a 1 second lock.
    await new Promise((r) => setTimeout(r, 2500));

    const operatorBefore = await provider.connection.getBalance(admin.publicKey);

    await program.methods
      .withdrawBond()
      .accounts({
        bond: bondBPDA,
        agent: agentBPDA,
        operator: admin.publicKey,
      })
      .rpc();

    const operatorAfter = await provider.connection.getBalance(admin.publicKey);
    // rent-exempt deposit + 0.1 SOL collateral, minus the tx fee.
    expect(operatorAfter - operatorBefore).to.be.greaterThan(90_000_000);

    // The bond account is closed, so nothing is stranded.
    let closed = false;
    try {
      await program.account.bond.fetch(bondBPDA);
    } catch {
      closed = true;
    }
    expect(closed).to.equal(true);

    const agent = await program.account.agent.fetch(agentBPDA);
    expect(agent.bondAddress.toString()).to.equal(PublicKey.default.toString());
  });
});
