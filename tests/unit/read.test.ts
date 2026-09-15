/**
 * Read-layer tests — no validator, no network.
 *
 * The read layer is what turns bonds and slashes into a question a counterparty
 * can actually ask: "does this agent have collateral at risk, and has it been
 * slashed?" Two classes of bug matter here and both are caught below:
 *
 *   * **wrong filters** — a mis-encoded `memcmp` makes `getProgramAccounts`
 *     return an empty array, which is indistinguishable from "no bonds exist".
 *     The fake fetcher therefore *records* the filters it was asked for.
 *   * **wrong derivation** — a score that ignores an unpaid slash, or grants an
 *     "A" to an agent with no bond at all, is worse than no score.
 */
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import {
  AccountFetcher,
  FetcherConfig,
  RawAccount,
  bs58Encode,
  buildTrustProfile,
  discriminatorFilter,
  lamportsToSol,
  listAgents,
  listBonds,
  listConstraints,
  listSlashRecords,
  pubkeyFilter,
} from "../../sdk/src/read";
import {
  ACCOUNT_DISCRIMINATORS,
  AgentStatus,
  AgentType,
  ConstraintType,
  decodeAgent,
  decodeBond,
  decodeConstraint,
  decodeSlashRecord,
} from "../../eliza-plugin/src/coder";

const PROGRAM_ID = new PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");
const AGENT = new PublicKey("So11111111111111111111111111111111111111112");
const OWNER = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const VICTIM = new PublicKey("SysvarRent111111111111111111111111111111111");

const DECODERS = {
  agent: decodeAgent,
  bond: decodeBond,
  constraint: decodeConstraint,
  slashRecord: decodeSlashRecord,
};

/** A fake `Connection` that records every query and replays fixed fixtures. */
class FakeFetcher implements AccountFetcher {
  public queries: Array<{ programId: PublicKey; config: FetcherConfig }> = [];

  private fixtures: RawAccount[];

  constructor(fixtures: RawAccount[]) {
    this.fixtures = fixtures;
  }

  async getProgramAccounts(programId: PublicKey, config: FetcherConfig): Promise<RawAccount[]> {
    this.queries.push({ programId, config });
    return this.fixtures;
  }
}

function raw(data: Buffer, pubkey = AGENT): RawAccount {
  return {
    pubkey,
    account: {
      data,
      lamports: 2_000_000,
      owner: PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    },
  };
}

describe("read layer", () => {
  describe("base58 encoding", () => {
    it("matches PublicKey.toBase58 for real 32-byte keys", () => {
      for (const key of [AGENT, OWNER, VICTIM, PROGRAM_ID, PublicKey.default]) {
        expect(bs58Encode(key.toBuffer())).to.equal(key.toBase58());
      }
    });

    it("preserves leading zero bytes as leading 1s", () => {
      expect(bs58Encode(Buffer.alloc(4))).to.equal("1111");
    });
  });

  describe("filters", () => {
    it("encodes a discriminator as the base58 of its 8 bytes", () => {
      const filter = discriminatorFilter(ACCOUNT_DISCRIMINATORS.Agent);
      expect(filter.memcmp.offset).to.equal(0);
      expect(filter.memcmp.bytes).to.equal(bs58Encode(ACCOUNT_DISCRIMINATORS.Agent));
    });

    it("refuses a discriminator that is not 8 bytes", () => {
      expect(() => discriminatorFilter(Buffer.alloc(7))).to.throw(/8 bytes/);
    });

    it("filters a nested pubkey at the offset it is stored at", () => {
      // `agent` is the first field after the 8-byte discriminator on both
      // Bond and SlashRecord, so offset 8 is the one that matters.
      expect(pubkeyFilter(AGENT, 8)).to.deep.equal({
        memcmp: { offset: 8, bytes: AGENT.toBase58() },
      });
    });
  });

  describe("listAgents / listBonds", () => {
    it("asks only for the Agent discriminator", async () => {
      const fetcher = new FakeFetcher([]);
      await listAgents(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS);

      expect(fetcher.queries).to.have.length(1);
      expect(fetcher.queries[0].config.filters).to.deep.equal([
        { memcmp: { offset: 0, bytes: bs58Encode(ACCOUNT_DISCRIMINATORS.Agent) } },
      ]);
    });

    it("asks only for the Bond discriminator", async () => {
      const fetcher = new FakeFetcher([]);
      await listBonds(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS);

      expect(fetcher.queries[0].config.filters).to.deep.equal([
        { memcmp: { offset: 0, bytes: bs58Encode(ACCOUNT_DISCRIMINATORS.Bond) } },
      ]);
    });

    it("returns the address alongside the decoded account", async () => {
      const bytes = agentBytes({ name: "scout" });
      const fetcher = new FakeFetcher([raw(bytes, AGENT)]);

      const agents = await listAgents(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS);
      expect(agents).to.have.length(1);
      expect(agents[0].address.toBase58()).to.equal(AGENT.toBase58());
      expect(agents[0].data.name).to.equal("scout");
    });

    it("decodes a full agent, including the v0.2 constraint counter", async () => {
      const bytes = agentBytes({ name: "atlas", constraintCount: 3, trustScore: 88 });
      const fetcher = new FakeFetcher([raw(bytes)]);

      const [agent] = await listAgents(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS);
      expect(agent.data.constraintCount).to.equal(3);
      expect(agent.data.trustScore).to.equal(88);
      expect(agent.data.owner).to.equal(OWNER.toBase58());
    });
  });

  describe("listSlashRecords / listConstraints", () => {
    it("scans the whole program when no agent is given", async () => {
      const fetcher = new FakeFetcher([]);
      await listSlashRecords(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS);

      expect(fetcher.queries[0].config.filters).to.have.length(1);
      expect(fetcher.queries[0].config.filters[0].memcmp.offset).to.equal(0);
    });

    it("narrows to one agent at offset 8 when given a pubkey", async () => {
      const fetcher = new FakeFetcher([]);
      await listSlashRecords(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS, AGENT);

      expect(fetcher.queries[0].config.filters).to.deep.equal([
        { memcmp: { offset: 0, bytes: bs58Encode(ACCOUNT_DISCRIMINATORS.SlashRecord) } },
        { memcmp: { offset: 8, bytes: AGENT.toBase58() } },
      ]);
    });

    it("narrows constraints the same way", async () => {
      const fetcher = new FakeFetcher([]);
      await listConstraints(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS, AGENT);

      expect(fetcher.queries[0].config.filters[1]).to.deep.equal({
        memcmp: { offset: 8, bytes: AGENT.toBase58() },
      });
    });

    it("decodes an uncompensated slash", async () => {
      const bytes = slashBytes({ amount: 2_500_000_000n, reason: "ilegit transfer" });
      const fetcher = new FakeFetcher([raw(bytes)]);

      const [slash] = await listSlashRecords(fetcher, PROGRAM_ID, DECODERS, ACCOUNT_DISCRIMINATORS);
      expect(slash.data.amount).to.equal(2_500_000_000n);
      expect(slash.data.compensated).to.equal(false);
      expect(slash.data.victim).to.equal(null);
    });
  });

  describe("lamportsToSol", () => {
    it("converts", () => {
      expect(lamportsToSol(1_500_000_000n)).to.equal(1.5);
      expect(lamportsToSol(0n)).to.equal(0);
    });
  });

  describe("buildTrustProfile", () => {
    const now = 1_800_000_000;

    function profile(overrides: Partial<Parameters<typeof buildTrustProfile>[0]> = {}) {
      return buildTrustProfile({
        agent: {
          address: AGENT,
          owner: OWNER,
          name: "atlas",
          trustScore: 50,
          status: AgentStatus.Active,
        },
        bond: {
          address: PublicKey.default,
          amount: 5_000_000_000n,
          lockedAt: now - 86_400,
          expiresAt: now + 86_400,
          isActive: true,
        },
        slashes: [],
        now,
        ...overrides,
      });
    }

    it("is ungraded when there is no bond, because nothing is at stake", () => {
      const p = profile({ bond: null });
      expect(p.grade).to.equal("ungraded");
      expect(p.bond).to.equal(null);
      expect(p.warnings.join(" ")).to.match(/nothing at stake/i);
    });

    it("is ungraded when the bond exists but holds zero lamports", () => {
      const p = profile({
        bond: {
          address: PublicKey.default,
          amount: 0n,
          lockedAt: now,
          expiresAt: now + 1,
          isActive: true,
        },
      });
      expect(p.grade).to.equal("ungraded");
    });

    it("grants an A to a bonded agent with no slashes", () => {
      const p = profile();
      expect(p.score).to.equal(100);
      expect(p.grade).to.equal("A");
      expect(p.stats.slashCount).to.equal(0);
    });

    it("penalises an inactive bond", () => {
      const p = profile({
        bond: {
          address: PublicKey.default,
          amount: 5_000_000_000n,
          lockedAt: now,
          expiresAt: now + 1,
          isActive: false,
        },
      });
      expect(p.score).to.equal(80);
      expect(p.warnings.join(" ")).to.match(/inactive/i);
    });

    it("subtracts ten per compensated slash, capped at forty", () => {
      // Compensated, so the additional unpaid-slash penalty is not in play and
      // this isolates the per-violation cost.
      const two = profile({
        slashes: [
          slashFixture({ nonce: 1n, compensated: true }),
          slashFixture({ nonce: 2n, compensated: true }),
        ],
      });
      expect(two.score).to.equal(80);

      const six = profile({
        slashes: [1n, 2n, 3n, 4n, 5n, 6n].map((nonce) =>
          slashFixture({ nonce, compensated: true })
        ),
      });
      expect(six.score).to.equal(60); // capped, not 40
    });

    it("charges both the per-slash cost and the unpaid penalty for an open slash", () => {
      const p = profile({
        slashes: [slashFixture({ nonce: 1n }), slashFixture({ nonce: 2n })],
      });
      // 100 - 20 (two slashes) - 24 (two unpaid) = 56
      expect(p.score).to.equal(56);
    });

    it("accounts slashed and compensated totals separately", () => {
      const p = profile({
        slashes: [
          slashFixture({ nonce: 1n, amount: 1_000_000_000n, compensated: true }),
          slashFixture({ nonce: 2n, amount: 2_000_000_000n }),
        ],
      });

      expect(p.stats.totalSlashedLamports).to.equal(3_000_000_000n);
      expect(p.stats.compensationPaidLamports).to.equal(1_000_000_000n);
      expect(p.stats.uncompensatedLamports).to.equal(2_000_000_000n);
      expect(p.stats.openSlashes).to.equal(1);
    });

    it("penalises an unpaid slash harder than a paid one and says so", () => {
      const paid = profile({
        slashes: [slashFixture({ nonce: 1n, compensated: true })],
      });
      const unpaid = profile({ slashes: [slashFixture({ nonce: 1n })] });

      expect(unpaid.score).to.be.lessThan(paid.score);
      expect(unpaid.warnings.join(" ")).to.match(/still owed/i);
      expect(paid.warnings.join(" ")).to.not.match(/still owed/i);
    });

    it("orders slashes by nonce regardless of input order", () => {
      const p = profile({
        slashes: [slashFixture({ nonce: 3n }), slashFixture({ nonce: 1n })],
      });
      expect(p.slashes.map((s) => Number(s.nonce))).to.deep.equal([1, 3]);
    });

    it("flags a thin sub-1-SOL bond", () => {
      const p = profile({
        bond: {
          address: PublicKey.default,
          amount: 500_000_000n,
          lockedAt: now,
          expiresAt: now + 1,
          isActive: true,
        },
      });
      expect(p.warnings.join(" ")).to.match(/under 1 SOL/i);
    });

    it("flags a Slashed status", () => {
      const p = profile({
        agent: {
          address: AGENT,
          owner: OWNER,
          name: "atlas",
          trustScore: 100,
          status: AgentStatus.Slashed,
        },
      });
      expect(p.warnings.join(" ")).to.match(/flagged Slashed/i);
      expect(p.score).to.equal(85);
    });

    it("reports the on-chain score without letting it raise the derived one", () => {
      // The on-chain score is admin-set, so a perfect 100 there must not lift
      // an agent that has no bond at all.
      const p = profile({
        bond: null,
        agent: {
          address: AGENT,
          owner: OWNER,
          name: "atlas",
          trustScore: 100,
          status: AgentStatus.Active,
        },
      });
      expect(p.onChainTrustScore).to.equal(100);
      expect(p.score).to.equal(55);
      expect(p.grade).to.equal("ungraded");
      expect(p.warnings.join(" ")).to.match(/admin-set/i);
    });

    it("marks a bond inside its lock window as locked and an elapsed one as expired", () => {
      const locked = profile();
      expect(locked.bond!.locked).to.equal(true);
      expect(locked.bond!.expired).to.equal(false);

      const expired = profile({
        bond: {
          address: PublicKey.default,
          amount: 1_000_000_000n,
          lockedAt: now - 172_800,
          expiresAt: now - 86_400,
          isActive: true,
        },
      });
      expect(expired.bond!.expired).to.equal(true);
      expect(expired.bond!.locked).to.equal(false);
    });

    it("never emits a score outside 0..100", () => {
      const p = profile({
        bond: null,
        slashes: [1n, 2n, 3n, 4n, 5n].map((nonce) => slashFixture({ nonce })),
      });
      expect(p.score).to.be.at.least(0);
      expect(p.score).to.be.at.most(100);
    });

    it("computes a monthly slash rate from the observed window", () => {
      // Two slashes, the first 15 days before `now`.
      const half = 15 * 24 * 60 * 60;
      const p = profile({
        slashes: [
          slashFixture({ nonce: 1n, timestamp: now - half }),
          slashFixture({ nonce: 2n, timestamp: now }),
        ],
      });
      expect(p.stats.slashRatePerMonth).to.be.closeTo(4, 0.01);
    });
  });
});

/* ── fixtures ──────────────────────────────────────────────────────────── */

function writePubkey(target: Buffer, offset: number, key: PublicKey): void {
  key.toBuffer().copy(target, offset);
}

function writeName(target: Buffer, offset: number, name: string): void {
  Buffer.from(name, "utf8").copy(target, offset);
}

function agentBytes(opts: {
  name: string;
  constraintCount?: number;
  trustScore?: number;
  status?: number;
}): Buffer {
  const b = Buffer.alloc(118);
  ACCOUNT_DISCRIMINATORS.Agent.copy(b, 0);
  writePubkey(b, 8, OWNER);
  writeName(b, 40, opts.name);
  b[72] = AgentType.Trader;
  b[73] = opts.trustScore ?? 50;
  b[74] = opts.status ?? AgentStatus.Active;
  writePubkey(b, 75, PublicKey.default);
  b.writeUInt16LE(opts.constraintCount ?? 0, 107);
  b.writeBigInt64LE(BigInt(1_700_000_000), 109);
  b[117] = 255;
  return b;
}

function slashBytes(opts: { amount: bigint; reason: string }): Buffer {
  const b = Buffer.alloc(259);
  ACCOUNT_DISCRIMINATORS.SlashRecord.copy(b, 0);
  writePubkey(b, 8, AGENT);
  writePubkey(b, 40, OWNER);
  b.writeBigUInt64LE(opts.amount, 72);
  writeName(b, 80, opts.reason);
  b.writeBigUInt64LE(1n, 208);
  b.writeBigInt64LE(BigInt(1_700_000_000), 216);
  b[224] = 0; // victim = None
  b[257] = 0; // not compensated
  b[258] = 255;
  return b;
}

/** Shape consumed by `buildTrustProfile` (already decoded). */
function slashFixture(opts: {
  nonce: bigint;
  amount?: bigint;
  compensated?: boolean;
  timestamp?: number;
}) {
  return {
    address: AGENT,
    amount: opts.amount ?? 1_000_000_000n,
    reason: "test",
    timestamp: opts.timestamp ?? 1_700_000_000,
    victim: null as string | null,
    compensated: opts.compensated ?? false,
    nonce: opts.nonce,
  };
}
