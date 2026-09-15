/**
 * Wire-format tests — these run with **no validator**.
 *
 * `anchor test` needs a full Solana + Anchor toolchain. Everything in this file
 * is pure byte manipulation, so it runs anywhere and it fails loudly if the
 * layouts in the clients ever drift from the program.
 *
 * The buffers below are built by hand, field by field, from the layout written
 * out in `SPEC.md`, and every offset is stated literally. That is deliberate:
 * if someone changes a client decoder, these tests break even if the decoder and
 * the encoder were changed together.
 */
import { expect } from "chai";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import {
  ACCOUNT_DISCRIMINATORS,
  AgentStatus,
  AgentType,
  ALLOWED_PROGRAMS_LEN,
  ConstraintType,
  MAX_CONSTRAINTS,
  accountDiscriminator,
  addConstraintData,
  compensateVictimData,
  createBondData,
  decodeAgent,
  decodeBond,
  decodeConfig,
  decodeConstraint,
  decodeName,
  decodeSlashRecord,
  decodeVault,
  encodeConstraintParams,
  executeSlashData,
  findAgentPDA,
  findBondPDA,
  findConfigPDA,
  findConstraintPDA,
  findSlashRecordPDA,
  findVaultPDA,
  initializeData,
  ixDiscriminator,
  registerAgentData,
  updateTrustScoreData,
  u16le,
  u64le,
  withdrawBondData,
  EQUXI_PROGRAM_ID,
} from "../../eliza-plugin/src/coder";

/** Independent SHA-256 so we are not just re-running Anchor's own helper. */
function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

const OTHER_KEY = new PublicKey("So11111111111111111111111111111111111111112");

describe("equxi wire format", () => {
  describe("discriminators", () => {
    it("derives instruction discriminators as sha256('global:'+name)[0..8]", () => {
      for (const name of [
        "initialize",
        "register_agent",
        "create_bond",
        "withdraw_bond",
        "add_constraint",
        "execute_slash",
        "compensate_victim",
        "update_trust_score",
      ]) {
        expect(ixDiscriminator(name).toString("hex")).to.equal(
          sha256(Buffer.from(`global:${name}`, "utf8"))
            .subarray(0, 8)
            .toString("hex")
        );
      }
    });

    it("derives account discriminators as sha256('account:'+Name)[0..8]", () => {
      for (const name of [
        "Config",
        "Vault",
        "Agent",
        "Bond",
        "Constraint",
        "SlashRecord",
      ]) {
        expect(accountDiscriminator(name).toString("hex")).to.equal(
          sha256(Buffer.from(`account:${name}`, "utf8"))
            .subarray(0, 8)
            .toString("hex")
        );
      }
    });

    it("keeps every instruction discriminator distinct", () => {
      const names = [
        "initialize",
        "register_agent",
        "create_bond",
        "withdraw_bond",
        "add_constraint",
        "execute_slash",
        "compensate_victim",
        "update_trust_score",
      ];
      const seen = new Set(names.map((n) => ixDiscriminator(n).toString("hex")));
      expect(seen.size).to.equal(names.length);
    });

    it("pins ACCOUNT_DISCRIMINATORS to independently computed values", () => {
      for (const [name, value] of Object.entries(ACCOUNT_DISCRIMINATORS)) {
        expect((value as Buffer).toString("hex")).to.equal(
          sha256(Buffer.from(`account:${name}`, "utf8"))
            .subarray(0, 8)
            .toString("hex")
        );
      }
    });
  });

  describe("instruction encoding", () => {
    it("encodes create_bond(amount: u64, lock_duration: i64) in order", () => {
      const data = createBondData(5_000_000_000n, 2_592_000n);
      expect(data.length).to.equal(24);
      expect(data.subarray(0, 8).toString("hex")).to.equal(
        ixDiscriminator("create_bond").toString("hex")
      );
      expect(data.readBigUInt64LE(8)).to.equal(5_000_000_000n);
      expect(data.readBigInt64LE(16)).to.equal(2_592_000n);
    });

    it("encodes register_agent(name: String, agent_type: u8) in order", () => {
      const data = registerAgentData("AlphaTrader", AgentType.Oracle);
      expect(data.length).to.equal(8 + 4 + "AlphaTrader".length + 1);
      expect(data.readUInt32LE(8)).to.equal("AlphaTrader".length);
      expect(data.subarray(12, 23).toString("utf8")).to.equal("AlphaTrader");
      expect(data[23]).to.equal(AgentType.Oracle);
    });

    it("encodes execute_slash(reason: String, slash_amount: u64) in order", () => {
      const reason = "Exceeded spend limit";
      const data = executeSlashData(reason, 100_000_000n);
      expect(data.readUInt32LE(8)).to.equal(reason.length);
      const after = 12 + Buffer.byteLength(reason);
      expect(data.subarray(12, after).toString("utf8")).to.equal(reason);
      expect(data.readBigUInt64LE(after)).to.equal(100_000_000n);
    });

    it("encodes add_constraint with a fixed-size 288-byte ConstraintParams", () => {
      const params = encodeConstraintParams({
        maxAmount: 1_000_000_000n,
        maxPerPeriod: 5_000_000_000n,
        periodSeconds: 86_400n,
        timelockSeconds: 0n,
        allowedPrograms: [OTHER_KEY],
      });
      expect(params.length).to.equal(288);
      expect(params.readBigUInt64LE(0)).to.equal(1_000_000_000n);
      expect(params.readBigUInt64LE(8)).to.equal(5_000_000_000n);
      expect(params.readBigInt64LE(16)).to.equal(86_400n);
      expect(params.readBigInt64LE(24)).to.equal(0n);
      expect(params.subarray(32, 64).toString("hex")).to.equal(
        OTHER_KEY.toBuffer().toString("hex")
      );
      // Unfilled program slots must be zeroed, not garbage or truncated.
      expect(params.subarray(64, 288).every((b) => b === 0)).to.equal(true);

      const data = addConstraintData(ConstraintType.SpendLimit, {
        maxAmount: 1_000_000_000n,
        maxPerPeriod: 5_000_000_000n,
        periodSeconds: 86_400n,
        timelockSeconds: 0n,
        allowedPrograms: [OTHER_KEY],
      });
      expect(data.length).to.equal(8 + 1 + 288);
      expect(data[8]).to.equal(ConstraintType.SpendLimit);
    });

    it("pads allowed_programs to exactly 8 entries", () => {
      const params = encodeConstraintParams({
        maxAmount: 1n,
        maxPerPeriod: 1n,
        periodSeconds: 1n,
        timelockSeconds: 0n,
        allowedPrograms: [OTHER_KEY, OTHER_KEY, OTHER_KEY],
      });
      expect(params.length).to.equal(288);
      const slot3 = params.subarray(32 + 3 * 32, 32 + 4 * 32);
      expect(slot3.every((b) => b === 0)).to.equal(true);
      expect(ALLOWED_PROGRAMS_LEN).to.equal(8);
    });

    it("sizes the remaining instructions", () => {
      expect(withdrawBondData().length).to.equal(8);
      expect(initializeData().length).to.equal(8);
      expect(compensateVictimData(1n).length).to.equal(16);
      expect(updateTrustScoreData(80).length).to.equal(9);
      expect(withdrawBondData().toString("hex")).to.not.equal(
        initializeData().toString("hex")
      );
    });

    it("matches the Rust enum declaration order", () => {
      expect([
        AgentType.Trader,
        AgentType.Oracle,
        AgentType.DeFi,
        AgentType.Payment,
        AgentType.NFT,
        AgentType.Governance,
        AgentType.Bridge,
        AgentType.Custom,
      ]).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7]);

      expect([
        ConstraintType.SpendLimit,
        ConstraintType.ProgramAllowlist,
        ConstraintType.Timelock,
        ConstraintType.Velocity,
        ConstraintType.Custom,
      ]).to.deep.equal([0, 1, 2, 3, 4]);

      expect([
        AgentStatus.Active,
        AgentStatus.Pending,
        AgentStatus.Slashed,
        AgentStatus.Deactivated,
      ]).to.deep.equal([0, 1, 2, 3]);
    });
  });

  describe("PDA seeds", () => {
    const agent = findAgentPDA(OTHER_KEY, "AlphaTrader");

    it("derives config and vault from single literals", () => {
      expect(findConfigPDA().equals(
        PublicKey.findProgramAddressSync([Buffer.from("config")], EQUXI_PROGRAM_ID)[0]
      )).to.equal(true);
      expect(findVaultPDA().equals(
        PublicKey.findProgramAddressSync([Buffer.from("vault")], EQUXI_PROGRAM_ID)[0]
      )).to.equal(true);
      expect(findConfigPDA().equals(findVaultPDA())).to.equal(false);
    });

    it("derives agent as ['agent', owner, name]", () => {
      expect(agent.equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("agent"), OTHER_KEY.toBuffer(), Buffer.from("AlphaTrader")],
          EQUXI_PROGRAM_ID
        )[0]
      )).to.equal(true);
    });

    it("derives bond as ['bond', agent] — one bond per agent", () => {
      expect(findBondPDA(agent).equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("bond"), agent.toBuffer()],
          EQUXI_PROGRAM_ID
        )[0]
      )).to.equal(true);
    });

    it("seeds constraints on a u16 counter, so an agent can hold many rules", () => {
      const addresses = [0, 1, 2, 3].map((i) => findConstraintPDA(agent, i).toBase58());
      expect(new Set(addresses).size).to.equal(4);

      // Regression: the old seed used a u64, which produced a different address
      // and, worse, seeded from a global counter that only ever yielded one
      // constraint per agent.
      const asU64 = PublicKey.findProgramAddressSync(
        [Buffer.from("constraint"), agent.toBuffer(), u64le(0)],
        EQUXI_PROGRAM_ID
      )[0];
      expect(findConstraintPDA(agent, 0).equals(asU64)).to.equal(false);
      expect(findConstraintPDA(agent, 0).equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("constraint"), agent.toBuffer(), u16le(0)],
          EQUXI_PROGRAM_ID
        )[0]
      )).to.equal(true);
    });

    it("derives the slash record from the slash nonce", () => {
      expect(findSlashRecordPDA(agent, 7).equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("slash"), agent.toBuffer(), u64le(7)],
          EQUXI_PROGRAM_ID
        )[0]
      )).to.equal(true);
      expect(findSlashRecordPDA(agent, 0).equals(findSlashRecordPDA(agent, 1)))
        .to.equal(false);
    });

    it("caps rules per agent at 16", () => {
      expect(MAX_CONSTRAINTS).to.equal(16);
    });
  });

  describe("account decoding", () => {
    const ADMIN = OTHER_KEY.toBuffer();
    const AGENT_KEY = findAgentPDA(OTHER_KEY, "AlphaTrader").toBuffer();

    /** Config: disc(8) admin(32) total_agents(8) total_bonds(8) total_slashed(8) bumped(1) */
    function buildConfig(totalSlashes: bigint): Buffer {
      const b = Buffer.alloc(65);
      ADMIN.copy(b, 8);
      b.writeBigUInt64LE(12n, 40); // total_agents
      b.writeBigUInt64LE(9n, 48); // total_bonds
      b.writeBigUInt64LE(totalSlashes, 56); // total_slashed
      b[64] = 254; // bumped
      return b;
    }

    /** Vault: disc(8) total_slashed(8) total_compensated(8) bumped(1) */
    function buildVault(slashed: bigint, compensated: bigint): Buffer {
      const b = Buffer.alloc(25);
      b.writeBigUInt64LE(slashed, 8);
      b.writeBigUInt64LE(compensated, 16);
      b[24] = 253;
      return b;
    }

    /** Agent: disc(8) owner(32) name(32) type(1) trust(1) status(1) bond(32) count(2) created(8) bump(1) */
    function buildAgent(): Buffer {
      const b = Buffer.alloc(118);
      ADMIN.copy(b, 8);
      Buffer.from("AlphaTrader", "utf8").copy(b, 40);
      b[72] = AgentType.Oracle;
      b[73] = 50;
      b[74] = AgentStatus.Active;
      AGENT_KEY.copy(b, 75);
      b.writeUInt16LE(3, 107); // constraint_count
      b.writeBigInt64LE(1_700_000_000n, 109); // created_at
      b[117] = 252;
      return b;
    }

    /** Bond: disc(8) agent(32) operator(32) amount(8) lock(8) locked(8) expires(8) active(1) bump(1) */
    function buildBond(): Buffer {
      const b = Buffer.alloc(106);
      AGENT_KEY.copy(b, 8);
      ADMIN.copy(b, 40);
      b.writeBigUInt64LE(5_000_000_000n, 72);
      b.writeBigInt64LE(2_592_000n, 80);
      b.writeBigInt64LE(1_700_000_000n, 88);
      b.writeBigInt64LE(1_702_592_000n, 96);
      b[104] = 1;
      b[105] = 251;
      return b;
    }

    /**
     * Constraint: disc(8) agent(32) type(1) params(288) enforced(1) created(8) bump(1)
     * params = max_amount(8) max_per_period(8) period(8) timelock(8) programs(8x32)
     */
    function buildConstraint(): Buffer {
      const b = Buffer.alloc(339);
      AGENT_KEY.copy(b, 8);
      b[40] = ConstraintType.SpendLimit;
      b.writeBigUInt64LE(1_000_000_000n, 41);
      b.writeBigUInt64LE(5_000_000_000n, 49);
      b.writeBigInt64LE(86_400n, 57);
      b.writeBigInt64LE(0n, 65);
      OTHER_KEY.toBuffer().copy(b, 73); // slot 0 only
      b[329] = 1; // is_enforced
      b.writeBigInt64LE(1_700_000_000n, 330);
      b[338] = 249;
      return b;
    }

    /** SlashRecord: disc(8) agent(32) auth(32) amount(8) reason(128) nonce(8) ts(8) victim(1+32) comp(1) bump(1) */
    function buildSlashRecord(withVictim: boolean): Buffer {
      const b = Buffer.alloc(259);
      AGENT_KEY.copy(b, 8);
      ADMIN.copy(b, 40);
      b.writeBigUInt64LE(1_000_000_000n, 72);
      Buffer.from("Exceeded spend limit", "utf8").copy(b, 80);
      b.writeBigUInt64LE(4n, 208); // nonce
      b.writeBigInt64LE(1_700_000_000n, 216); // timestamp
      if (withVictim) {
        b[224] = 1;
        OTHER_KEY.toBuffer().copy(b, 225);
      }
      b[257] = withVictim ? 1 : 0;
      b[258] = 250;
      return b;
    }

    it("decodes Config, treating total_slashed as a counter", () => {
      const c = decodeConfig(buildConfig(4n));
      expect(c.admin).to.equal(OTHER_KEY.toBase58());
      expect(c.totalAgents).to.equal(12);
      expect(c.totalBonds).to.equal(9);
      expect(c.totalSlashes).to.equal(4);
      expect(c.bumped).to.equal(254);
    });

    it("decodes Vault and reports available escrow", () => {
      const v = decodeVault(buildVault(3_000_000_000n, 1_000_000_000n));
      expect(v.totalSlashed).to.equal(3_000_000_000n);
      expect(v.totalCompensated).to.equal(1_000_000_000n);
      expect(v.available).to.equal(2_000_000_000n);
      expect(v.bumped).to.equal(253);

      // A fully compensated vault must report zero, never underflow.
      expect(decodeVault(buildVault(5n, 5n)).available).to.equal(0n);
    });

    it("decodes Agent at the post-change offsets", () => {
      const a = decodeAgent(buildAgent());
      expect(a.owner).to.equal(OTHER_KEY.toBase58());
      expect(a.name).to.equal("AlphaTrader");
      expect(a.agentType).to.equal(AgentType.Oracle);
      expect(a.trustScore).to.equal(50);
      expect(a.status).to.equal(AgentStatus.Active);
      expect(a.bondAddress).to.equal(new PublicKey(AGENT_KEY).toBase58());
      expect(a.constraintCount).to.equal(3);
      expect(a.createdAt).to.equal(1_700_000_000);
      expect(a.bumped).to.equal(252);
    });

    it("decodes a full-length Bond (106 bytes)", () => {
      const b = decodeBond(buildBond());
      expect(b.agent).to.equal(new PublicKey(AGENT_KEY).toBase58());
      expect(b.operator).to.equal(OTHER_KEY.toBase58());
      expect(b.amount).to.equal(5_000_000_000n);
      expect(b.lockDuration).to.equal(2_592_000);
      expect(b.lockedAt).to.equal(1_700_000_000);
      expect(b.expiresAt).to.equal(1_702_592_000);
      expect(b.isActive).to.equal(true);
      expect(b.bumped).to.equal(251);
    });

    it("decodes Constraint including its 288-byte params block", () => {
      const c = decodeConstraint(buildConstraint());
      expect(c.agent).to.equal(new PublicKey(AGENT_KEY).toBase58());
      expect(c.constraintType).to.equal(ConstraintType.SpendLimit);
      expect(c.params.maxAmount).to.equal(1_000_000_000n);
      expect(c.params.maxPerPeriod).to.equal(5_000_000_000n);
      expect(c.params.periodSeconds).to.equal(86_400);
      expect(c.params.timelockSeconds).to.equal(0);
      expect(c.params.allowedPrograms).to.have.length(8);
      expect(c.params.allowedPrograms[0].toBase58()).to.equal(
        OTHER_KEY.toBase58()
      );
      expect(c.isEnforced).to.equal(true);
      expect(c.createdAt).to.equal(1_700_000_000);
      expect(c.bumped).to.equal(249);
    });

    it("decodes SlashRecord with and without a victim", () => {
      const without = decodeSlashRecord(buildSlashRecord(false));
      expect(without.amount).to.equal(1_000_000_000n);
      expect(without.reason).to.equal("Exceeded spend limit");
      expect(without.nonce).to.equal(4n);
      expect(without.victim).to.equal(null);
      expect(without.compensated).to.equal(false);

      const withVictim = decodeSlashRecord(buildSlashRecord(true));
      expect(withVictim.victim).to.equal(OTHER_KEY.toBase58());
      expect(withVictim.compensated).to.equal(true);
    });

    it("trims the fixed-width name at the first NUL", () => {
      const b = buildAgent();
      expect(decodeName(b, 40)).to.equal("AlphaTrader");
      Buffer.alloc(32).copy(b, 40);
      expect(decodeName(b, 40)).to.equal("");
    });

    it("rejects buffers that are too short instead of reading garbage", () => {
      expect(() => decodeConfig(Buffer.alloc(64))).to.throw(/at least 65/);
      expect(() => decodeVault(Buffer.alloc(24))).to.throw(/at least 25/);
      expect(() => decodeAgent(Buffer.alloc(117))).to.throw(/at least 118/);
      expect(() => decodeBond(Buffer.alloc(105))).to.throw(/at least 106/);
      expect(() => decodeSlashRecord(Buffer.alloc(258))).to.throw(/at least 259/);
    });
  });
});
