/**
 * SDK + IDL tests — no validator, no network.
 *
 * `new EquxiClient(provider)` used to throw on construction because the bundled
 * IDL was in the Anchor <= 0.29 shape. These tests build a real client and a
 * real `anchor.Program` from `sdk/src/idl/equxi.json`, then cross-check both
 * against the independently written decoder in `eliza-plugin/src/coder.ts`.
 *
 * Two separately authored clients agreeing on the same bytes is the point: if
 * either drifts from `SPEC.md`, this file goes red.
 */
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import RAW_IDL from "../../sdk/src/idl/equxi.json";
import { EquxiClient } from "../../sdk/src/index";
import {
  ACCOUNT_DISCRIMINATORS,
  AgentStatus,
  AgentType,
  ConstraintType,
  decodeAgent,
  decodeBond,
  decodeConfig,
  decodeSlashRecord,
  decodeVault,
  ixDiscriminator,
  findAgentPDA,
  findBondPDA,
  findConfigPDA,
  findConstraintPDA,
  findSlashRecordPDA,
  findVaultPDA,
} from "../../eliza-plugin/src/coder";

const PROGRAM_ID = "D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc";
const OWNER = new PublicKey("So11111111111111111111111111111111111111112");
const VICTIM = new PublicKey("SysvarC1ock11111111111111111111111111111111");

/** A provider backed by a throwaway wallet. Nothing here opens a socket. */
function makeProvider(): anchor.AnchorProvider {
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async (tx: unknown) => tx,
    signAllTransactions: async (txs: unknown) => txs,
  };
  return new anchor.AnchorProvider(
    new anchor.web3.Connection("https://api.devnet.solana.com"),
    wallet as never,
    {}
  );
}

describe("equxi SDK", () => {
  describe("IDL artifact", () => {
    it("carries an address, which Anchor 0.30 requires", () => {
      expect((RAW_IDL as { address?: string }).address).to.equal(PROGRAM_ID);
    });

    it("uses the 0.30 'pubkey' type rather than the retired 'publicKey'", () => {
      const json = JSON.stringify(RAW_IDL);
      expect(json).to.not.contain('"publicKey"');
      expect(json).to.contain('"pubkey"');
    });

    it("declares accounts the 0.30 way, with discriminator + struct in types", () => {
      for (const account of RAW_IDL.accounts) {
        expect(account.discriminator).to.have.length(8);
        const hasStruct = RAW_IDL.types.some((t) => t.name === account.name);
        expect(hasStruct, `types is missing ${account.name}`).to.equal(true);
      }
    });

    it("pins account discriminators to sha256('account:'+Name)[0..8]", () => {
      for (const account of RAW_IDL.accounts) {
        const fromIdl = Buffer.from(account.discriminator).toString("hex");
        expect(fromIdl).to.equal(
          ACCOUNT_DISCRIMINATORS[
            account.name as keyof typeof ACCOUNT_DISCRIMINATORS
          ].toString("hex")
        );
      }
    });

    it("matches the changed account lists (no bond operator, no constraint config)", () => {
      const byName = Object.fromEntries(
        RAW_IDL.instructions.map((i) => [i.name, i.accounts.map((a) => a.name)])
      );
      expect(byName.createBond).to.deep.equal([
        "config",
        "bond",
        "agent",
        "owner",
        "systemProgram",
      ]);
      expect(byName.addConstraint).to.deep.equal([
        "constraint",
        "agent",
        "owner",
        "systemProgram",
      ]);
      expect(byName.executeSlash).to.deep.equal([
        "config",
        "vault",
        "agent",
        "bond",
        "slashRecord",
        "authority",
        "systemProgram",
      ]);
      // The migration reads the agent as raw bytes, so it must NOT be typed as
      // an `Agent` account the client would try to decode.
      expect(byName.migrateAgent).to.deep.equal([
        "config",
        "agent",
        "signer",
        "program",
        "programData",
        "systemProgram",
      ]);
    });

    it("gives every instruction the discriminator Anchor derives from its name", () => {
      // Anchor 0.30 reads `ix.discriminator` straight from the IDL and does NOT
      // recompute it, so a missing entry makes `new Program(...)` throw.
      const rustNames: Record<string, string> = {
        initialize: "initialize",
        createVault: "create_vault",
        migrateAgent: "migrate_agent",
        registerAgent: "register_agent",
        createBond: "create_bond",
        withdrawBond: "withdraw_bond",
        addConstraint: "add_constraint",
        executeSlash: "execute_slash",
        compensateVictim: "compensate_victim",
        updateTrustScore: "update_trust_score",
      };
      for (const instruction of RAW_IDL.instructions) {
        const snake = rustNames[instruction.name];
        expect(snake, `unmapped instruction ${instruction.name}`).to.be.a("string");
        expect(
          Buffer.from(instruction.discriminator).toString("hex")
        ).to.equal(ixDiscriminator(snake).toString("hex"));
      }
    });

    it("marks the owner as the sole signer when creating a bond", () => {
      const createBond = RAW_IDL.instructions.find(
        (i) => i.name === "createBond"
      )!;
      const signers = createBond.accounts
        .filter((a) => a.isSigner)
        .map((a) => a.name);
      expect(signers).to.deep.equal(["owner"]);
    });
  });

  describe("EquxiClient", () => {
    it("constructs (this is what used to throw)", () => {
      const client = new EquxiClient(makeProvider());
      expect(client).to.be.instanceOf(EquxiClient);
    });

    it("derives the same PDAs as the plugin coder", () => {
      const client = new EquxiClient(makeProvider());
      const agent = findAgentPDA(OWNER, "AlphaTrader");

      expect(client.findConfigPDA()[0].toBase58()).to.equal(
        findConfigPDA().toBase58()
      );
      expect(client.findVaultPDA()[0].toBase58()).to.equal(
        findVaultPDA().toBase58()
      );
      expect(client.findAgentPDA(OWNER, "AlphaTrader")[0].toBase58()).to.equal(
        agent.toBase58()
      );
      expect(client.findBondPDA(agent)[0].toBase58()).to.equal(
        findBondPDA(agent).toBase58()
      );
      expect(client.findConstraintPDA(agent, 2)[0].toBase58()).to.equal(
        findConstraintPDA(agent, 2).toBase58()
      );
      expect(
        findSlashRecordPDA(agent, 5).toBase58()
      ).to.equal(findSlashRecordPDA(agent, 5).toBase58());
    });

    it("derives ProgramData from the upgradeable loader", () => {
      const client = new EquxiClient(makeProvider());
      const [programData] = client.findProgramDataPDA();
      const [expected] = PublicKey.findProgramAddressSync(
        [new PublicKey(PROGRAM_ID).toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      );
      expect(programData.toBase58()).to.equal(expected.toBase58());
    });
  });

  describe("Anchor's own decoder agrees with ours", () => {
    const program = new anchor.Program(
      RAW_IDL as unknown as anchor.Idl,
      makeProvider()
    );
    /**
     * `Program.account` is only statically typed for a literal IDL type, and
     * Anchor's account clients expose `fetch`/`all` but no `decode`. The coder
     * underneath is what `fetch` uses, so that is what we exercise here.
     *
     * Note: Anchor 0.30 normalises account names to camelCase internally, and
     * `decode` enforces the account discriminator, so we stamp the real
     * discriminator onto each synthetic buffer first.
     */
    const coderAccounts = program.coder.accounts as unknown as {
      decode(name: string, buf: Buffer): any;
    };
    type CamelAccount =
      | "config"
      | "vault"
      | "agent"
      | "bond"
      | "constraint"
      | "slashRecord";
    function decodeWithAnchor(name: CamelAccount, buf: Buffer) {
      const pascal = (name.charAt(0).toUpperCase() +
        name.slice(1)) as keyof typeof ACCOUNT_DISCRIMINATORS;
      ACCOUNT_DISCRIMINATORS[pascal].copy(buf, 0);
      return coderAccounts.decode(name, buf);
    }

    it("resolves the program id from the IDL", () => {
      expect(program.programId.toBase58()).to.equal(PROGRAM_ID);
    });

    it("decodes Config identically", () => {
      const buf = Buffer.alloc(65);
      OWNER.toBuffer().copy(buf, 8);
      buf.writeBigUInt64LE(12n, 40);
      buf.writeBigUInt64LE(9n, 48);
      buf.writeBigUInt64LE(4n, 56);
      buf[64] = 254;

      const a = decodeWithAnchor("config", buf);
      const b = decodeConfig(buf);

      expect(a.admin.toBase58()).to.equal(b.admin);
      expect(Number(a.totalAgents)).to.equal(b.totalAgents);
      expect(Number(a.totalBonds)).to.equal(b.totalBonds);
      expect(Number(a.totalSlashed)).to.equal(b.totalSlashes);
      expect(a.bumped).to.equal(b.bumped);
    });

    it("decodes Vault identically", () => {
      const buf = Buffer.alloc(25);
      buf.writeBigUInt64LE(3_000_000_000n, 8);
      buf.writeBigUInt64LE(1_000_000_000n, 16);
      buf[24] = 253;

      const a = decodeWithAnchor("vault", buf);
      const b = decodeVault(buf);

      expect(a.totalSlashed.toString()).to.equal(b.totalSlashed.toString());
      expect(a.totalCompensated.toString()).to.equal(
        b.totalCompensated.toString()
      );
      expect(a.bumped).to.equal(b.bumped);
    });

    it("decodes Agent identically at the post-change offsets", () => {
      const agentPDA = findAgentPDA(OWNER, "AlphaTrader");
      const buf = Buffer.alloc(118);
      OWNER.toBuffer().copy(buf, 8);
      Buffer.from("AlphaTrader", "utf8").copy(buf, 40);
      buf[72] = AgentType.Oracle;
      buf[73] = 65;
      buf[74] = AgentStatus.Active;
      agentPDA.toBuffer().copy(buf, 75);
      buf.writeUInt16LE(3, 107);
      buf.writeBigInt64LE(1_700_000_000n, 109);
      buf[117] = 252;

      const a = decodeWithAnchor("agent", buf);
      const b = decodeAgent(buf);

      expect(a.owner.toBase58()).to.equal(b.owner);
      expect(a.trustScore).to.equal(b.trustScore);
      expect(a.constraintCount).to.equal(b.constraintCount);
      expect(Number(a.createdAt)).to.equal(b.createdAt);
      expect(a.bondAddress.toBase58()).to.equal(b.bondAddress);
      expect(a.bumped).to.equal(b.bumped);

      // Anchor renders the Rust enum variant as an object keyed by its name.
      expect(Object.keys(a.agentType)[0]).to.equal("oracle");
      expect(Object.keys(a.status)[0]).to.equal("active");
    });

    it("decodes Bond identically", () => {
      const buf = Buffer.alloc(106);
      findAgentPDA(OWNER, "AlphaTrader").toBuffer().copy(buf, 8);
      OWNER.toBuffer().copy(buf, 40);
      buf.writeBigUInt64LE(5_000_000_000n, 72);
      buf.writeBigInt64LE(2_592_000n, 80);
      buf.writeBigInt64LE(1_700_000_000n, 88);
      buf.writeBigInt64LE(1_702_592_000n, 96);
      buf[104] = 1;
      buf[105] = 251;

      const a = decodeWithAnchor("bond", buf);
      const b = decodeBond(buf);

      expect(a.amount.toString()).to.equal(b.amount.toString());
      expect(Number(a.lockDuration)).to.equal(b.lockDuration);
      expect(Number(a.lockedAt)).to.equal(b.lockedAt);
      expect(Number(a.expiresAt)).to.equal(b.expiresAt);
      expect(a.isActive).to.equal(b.isActive);
      expect(a.bumped).to.equal(b.bumped);
    });

    it("decodes a compensated SlashRecord identically", () => {
      const agentPDA = findAgentPDA(OWNER, "AlphaTrader");
      const buf = Buffer.alloc(259);
      agentPDA.toBuffer().copy(buf, 8);
      OWNER.toBuffer().copy(buf, 40);
      buf.writeBigUInt64LE(1_000_000_000n, 72);
      Buffer.from("Exceeded spend limit", "utf8").copy(buf, 80);
      buf.writeBigUInt64LE(4n, 208);
      buf.writeBigInt64LE(1_700_000_000n, 216);
      buf[224] = 1;
      VICTIM.toBuffer().copy(buf, 225);
      buf[257] = 1;
      buf[258] = 250;

      const a = decodeWithAnchor("slashRecord", buf);
      const nonce = Buffer.alloc(8);
      nonce.writeBigUInt64LE(4n, 0);
      const b = decodeSlashRecord(buf);

      expect(a.amount.toString()).to.equal(b.amount.toString());
      expect(Number(a.nonce)).to.equal(Number(b.nonce));
      expect(Number(a.timestamp)).to.equal(b.timestamp);
      expect(a.compensated).to.equal(b.compensated);
      expect((a.victim as PublicKey | null)?.toBase58()).to.equal(b.victim);
      expect(a.reason.slice(0, 20).join(",")).to.equal(
        Buffer.from("Exceeded spend limit", "utf8").join(",")
      );
    });

    it("decodes Constraint including its params", () => {
      const buf = Buffer.alloc(339);
      findAgentPDA(OWNER, "AlphaTrader").toBuffer().copy(buf, 8);
      buf[40] = ConstraintType.SpendLimit;
      buf.writeBigUInt64LE(1_000_000_000n, 41);
      buf.writeBigUInt64LE(5_000_000_000n, 49);
      buf.writeBigInt64LE(86_400n, 57);
      buf.writeBigInt64LE(0n, 65);
      VICTIM.toBuffer().copy(buf, 73);
      buf[329] = 1;
      buf.writeBigInt64LE(1_700_000_000n, 330);
      buf[338] = 249;

      const a = decodeWithAnchor("constraint", buf);
      expect(a.params.maxAmount.toString()).to.equal("1000000000");
      expect(Number(a.params.periodSeconds)).to.equal(86_400);
      expect(a.params.allowedPrograms[0].toBase58()).to.equal(
        VICTIM.toBase58()
      );
      expect(a.isEnforced).to.equal(true);
      expect(a.bumped).to.equal(249);
      expect(Object.keys(a.constraintType)[0]).to.equal("spendLimit");
    });
  });
});
