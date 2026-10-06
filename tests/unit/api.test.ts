/**
 * Read API tests — no network, no validator.
 *
 * `api/trust.js` is the only JavaScript that restates the on-chain layouts, so
 * it is the most likely place for silent drift. Two things are pinned here:
 *
 *   1. **The restatement is checked against the other restatement.** Every
 *      discriminator, size and decoded field is compared with
 *      `eliza-plugin/src/coder.ts`, whose discriminators are in turn pinned to
 *      `sha256("account:" + Name)`. So a layout change has to break a test, not
 *      a user's trust score.
 *   2. **The filters the endpoint actually sends are asserted.** A wrong
 *      `memcmp` offset returns zero accounts, which looks exactly like "this
 *      agent has no bond" — the most dangerous possible failure for a product
 *      whose claim is that collateral exists.
 */
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

// Default imports on purpose: the modules are CommonJS (`module.exports = ...`),
// and Node's native ESM loader maps that to the default export. `import =
// require` is not erasable syntax, so it cannot be used here — the test runner
// strips types rather than transpiling.
import L from "../../lib/equxi-layout";
import badge from "../../api/badge";
import health from "../../api/health";
import markets from "../../api/markets";
import trust from "../../api/trust";
import log from "../../lib/log";
import throttle from "../../lib/rate-limit";

/** Local aliases, because a default import does not bind the namespace types. */
type FetchImpl = (url: string, init: { body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<{ result?: unknown; error?: { message?: string } }>;
}>;
type Query = { agent?: string; owner?: string; cluster?: string; rpc?: string };
type Payload = Awaited<ReturnType<typeof trust.buildResponse>>;

import {
  ACCOUNT_DISCRIMINATORS as TS_DISCRIMINATORS,
  AgentStatus,
  AgentType,
  ConstraintType,
  decodeAgent as tsDecodeAgent,
  decodeBond as tsDecodeBond,
  decodeSlashRecord as tsDecodeSlashRecord,
} from "../../eliza-plugin/src/coder";

/* ── fixtures ─────────────────────────────────────────────────────────── */

const AGENT_ADDR = new PublicKey("So11111111111111111111111111111111111111112").toBase58();
const OWNER = new PublicKey("SysvarC1ock11111111111111111111111111111111").toBase58();
const OTHER_OWNER = new PublicKey("SysvarRent111111111111111111111111111111111").toBase58();

const NOW = 1_800_000_000;

function pubkeyBytes(base58: string): Uint8Array {
  const decoded = L.bs58Decode(base58);
  if (decoded.length !== 32) throw new Error("fixture pubkey is not 32 bytes: " + base58);
  return decoded;
}

function writePubkey(target: Uint8Array, offset: number, base58: string): void {
  target.set(pubkeyBytes(base58), offset);
}

function writeFixed(target: Uint8Array, offset: number, length: number, text: string): void {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > length) throw new Error("fixture string too long: " + text);
  bytes.copy(Buffer.from(target.buffer, target.byteOffset, target.byteLength), offset);
}

function agentFixture(opts: {
  name: string;
  owner?: string;
  constraintCount?: number;
  trustScore?: number;
  status?: number;
}): Uint8Array {
  const b = new Uint8Array(L.ACCOUNT_SIZES.Agent);
  b.set(L.ACCOUNT_DISCRIMINATORS.Agent, 0);
  writePubkey(b, 8, opts.owner ?? OWNER);
  writeFixed(b, 40, 32, opts.name);
  b[72] = AgentType.Trader;
  b[73] = opts.trustScore ?? 50;
  b[74] = opts.status ?? AgentStatus.Active;
  writePubkey(b, 75, PublicKey.default.toBase58());
  new DataView(b.buffer).setUint16(107, opts.constraintCount ?? 0, true);
  new DataView(b.buffer).setBigInt64(109, BigInt(1_700_000_000), true);
  b[117] = 255;
  return b;
}

function bondFixture(opts: { amount: bigint; isActive?: boolean }): Uint8Array {
  const b = new Uint8Array(L.ACCOUNT_SIZES.Bond);
  b.set(L.ACCOUNT_DISCRIMINATORS.Bond, 0);
  writePubkey(b, 8, AGENT_ADDR);
  writePubkey(b, 40, OWNER);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(72, opts.amount, true);
  dv.setBigInt64(80, 86_400n, true);
  dv.setBigInt64(88, BigInt(NOW - 86_400), true);
  dv.setBigInt64(96, BigInt(NOW + 86_400), true);
  b[104] = opts.isActive === false ? 0 : 1;
  b[105] = 255;
  return b;
}

function slashFixture(opts: { nonce: bigint; amount: bigint; compensated?: boolean }): Uint8Array {
  const b = new Uint8Array(L.ACCOUNT_SIZES.SlashRecord);
  b.set(L.ACCOUNT_DISCRIMINATORS.SlashRecord, 0);
  writePubkey(b, 8, AGENT_ADDR);
  writePubkey(b, 40, OWNER);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(72, opts.amount, true);
  writeFixed(b, 80, 128, "exceeded spend limit");
  dv.setBigUint64(208, opts.nonce, true);
  dv.setBigInt64(216, BigInt(1_700_000_000), true);
  b[224] = 0;
  b[257] = opts.compensated ? 1 : 0;
  b[258] = 255;
  return b;
}

function vaultFixture(slashed: bigint, compensated: bigint): Uint8Array {
  const b = new Uint8Array(L.ACCOUNT_SIZES.Vault);
  b.set(L.ACCOUNT_DISCRIMINATORS.Vault, 0);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(8, slashed, true);
  dv.setBigUint64(16, compensated, true);
  b[24] = 255;
  return b;
}

function constraintFixture(): Uint8Array {
  const b = new Uint8Array(L.ACCOUNT_SIZES.Constraint);
  b.set(L.ACCOUNT_DISCRIMINATORS.Constraint, 0);
  writePubkey(b, 8, AGENT_ADDR);
  b[40] = ConstraintType.SpendLimit;
  const dv = new DataView(b.buffer);
  dv.setBigUint64(41, 1_000_000_000n, true);
  b[329] = 1;
  dv.setBigInt64(330, BigInt(1_700_000_000), true);
  b[338] = 255;
  return b;
}

/* ── RPC stub ─────────────────────────────────────────────────────────── */

interface RpcCall {
  method: string;
  params: unknown[];
}

function accountEntry(pubkey: string, bytes: Uint8Array) {
  return {
    pubkey,
    account: {
      data: [Buffer.from(bytes).toString("base64"), "base64"],
      lamports: 2_000_000,
      owner: L.PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    },
  };
}

/**
 * A `fetch` stand-in that answers Solana JSON-RPC. Records every call so tests
 * can assert on the filters that were actually sent.
 */
class StubRpc {
  public calls: RpcCall[] = [];
  public failWith: string | null = null;

  private accounts: Record<string, Array<[string, Uint8Array]>>;

  constructor(accounts: Record<string, Array<[string, Uint8Array]>>) {
    this.accounts = accounts;
  }

  get fetchImpl(): FetchImpl {
    return async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as RpcCall;
      this.calls.push({ method: body.method, params: body.params });

      if (this.failWith) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ error: { message: this.failWith as string } }),
        };
      }

      if (body.method === "getProgramAccounts") {
        const filters = (body.params[1] as { filters: Array<{ memcmp: { bytes: string } }> })
          .filters;
        const disc = filters[0].memcmp.bytes;
        const name = Object.keys(L.ACCOUNT_DISCRIMINATORS).find(
          (n) => L.bs58Encode(Uint8Array.from(L.ACCOUNT_DISCRIMINATORS[n])) === disc
        );
        const rows = (name && this.accounts[name]) || [];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: rows.map(([pubkey, bytes]) => accountEntry(pubkey, bytes)),
          }),
        };
      }

      if (body.method === "getAccountInfo") {
        const address = body.params[0] as string;
        const all = Object.keys(this.accounts).reduce<Array<[string, Uint8Array]>>(
          (acc, key) => acc.concat(this.accounts[key]),
          []
        );
        const hit = all.find(([pubkey]) => pubkey === address);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: hit ? { value: accountEntry(hit[0], hit[1]).account } : { value: null },
          }),
        };
      }

      return { ok: true, status: 200, json: async () => ({ result: null }) };
    };
  }

  get rpcInstructions(): string[] {
    return this.calls.map((c) => c.method);
  }
}

function fullStub(): StubRpc {
  return new StubRpc({
    Agent: [[AGENT_ADDR, agentFixture({ name: "atlas", constraintCount: 1 })]],
    Bond: [["BondPdaPlaceholder", bondFixture({ amount: 5_000_000_000n })]],
    SlashRecord: [["SlashPdaPlaceholder", slashFixture({ nonce: 1n, amount: 1_000_000_000n })]],
    Constraint: [["ConstraintPda", constraintFixture()]],
    Vault: [["VaultPdaPlaceholder", vaultFixture(1_000_000_000n, 0n)]],
  });
}

/* ── tests ────────────────────────────────────────────────────────────── */

/**
 * The read API remembers the last complete registry read for a few minutes, so
 * a test that expects a failure must not inherit a snapshot from the one before
 * it. Reset before every test, not just the ones that mention snapshots.
 */
beforeEach(() => {
  trust.resetSnapshots();
});

describe("read API (api/trust.js)", () => {
  describe("declared layouts match the TypeScript decoder", () => {
    it("agrees on every account discriminator", () => {
      for (const name of Object.keys(L.ACCOUNT_DISCRIMINATORS)) {
        const ts = (TS_DISCRIMINATORS as Record<string, Buffer>)[name];
        expect(ts, `coder.ts is missing ${name}`).to.not.equal(undefined);
        expect(L.ACCOUNT_DISCRIMINATORS[name]).to.deep.equal(Array.from(ts as Uint8Array));
      }
    });

    it("agrees on every account size", () => {
      // The sizes are what `assertLength` guards, so a wrong number here means
      // silently truncated reads rather than a loud failure.
      expect(L.ACCOUNT_SIZES.Config).to.equal(65);
      expect(L.ACCOUNT_SIZES.Vault).to.equal(25);
      expect(L.ACCOUNT_SIZES.Agent).to.equal(118);
      expect(L.ACCOUNT_SIZES.Bond).to.equal(106);
      expect(L.ACCOUNT_SIZES.Constraint).to.equal(339);
      expect(L.ACCOUNT_SIZES.SlashRecord).to.equal(259);
    });

    it("decodes an Agent identically to coder.ts", () => {
      const bytes = Buffer.from(agentFixture({ name: "atlas", constraintCount: 3, trustScore: 88 }));
      const mine = L.decodeAgent(bytes);
      const theirs = tsDecodeAgent(bytes);

      expect(mine.owner).to.equal(theirs.owner);
      expect(mine.name).to.equal(theirs.name);
      expect(mine.trustScore).to.equal(theirs.trustScore);
      expect(mine.statusCode).to.equal(theirs.status as unknown as number);
      expect(mine.constraintCount).to.equal(theirs.constraintCount);
      expect(mine.createdAt).to.equal(theirs.createdAt);
    });

    it("decodes a Bond identically to coder.ts", () => {
      const bytes = Buffer.from(bondFixture({ amount: 2_500_000_000n }));
      const mine = L.decodeBond(bytes);
      const theirs = tsDecodeBond(bytes);

      expect(mine.agent).to.equal(theirs.agent);
      expect(mine.operator).to.equal(theirs.operator);
      expect(mine.amountLamports).to.equal(theirs.amount.toString());
      expect(mine.isActive).to.equal(theirs.isActive);
      expect(mine.expiresAt).to.equal(theirs.expiresAt);
    });

    it("decodes a SlashRecord identically to coder.ts", () => {
      const bytes = Buffer.from(slashFixture({ nonce: 7n, amount: 1_000_000_000n }));
      const mine = L.decodeSlashRecord(bytes);
      const theirs = tsDecodeSlashRecord(bytes);

      expect(mine.agent).to.equal(theirs.agent);
      expect(mine.reason).to.equal(theirs.reason);
      expect(mine.nonce).to.equal(theirs.nonce.toString());
      expect(mine.compensated).to.equal(theirs.compensated);
      expect(mine.victim).to.equal(theirs.victim);
    });

    it("rejects an account that is shorter than the layout", () => {
      expect(() => L.decodeAgent(Buffer.alloc(100))).to.throw(/expected at least 116/);
    });

    it("decodes the v0.1 Agent layout when the account is 116 bytes", () => {
      // The program deployed on devnet is v0.1 and its Agent accounts really are
      // 116 bytes (measured, not assumed). Without this branch the read API
      // returns a hard error against the live program.
      const v2 = Buffer.from(agentFixture({ name: "legacy", constraintCount: 7 }));
      const v1 = Buffer.concat([v2.subarray(0, 107), v2.subarray(109)]);
      expect(v1.length).to.equal(116);

      const decoded = L.decodeAgent(v1);
      expect(decoded.layout).to.equal("v1");
      expect(decoded.name).to.equal("legacy");
      // v0.1 has no counter, so 0 is reported rather than two bytes of
      // `created_at` misread as a count of 7.
      expect(decoded.constraintCount).to.equal(0);
      // `created_at` moved with the layout and must still read correctly.
      expect(decoded.createdAt).to.equal(1_700_000_000);
    });

    it("reports the v0.2 layout for a 118-byte Agent", () => {
      const decoded = L.decodeAgent(Buffer.from(agentFixture({ name: "new", constraintCount: 7 })));
      expect(decoded.layout).to.equal("v2");
      expect(decoded.constraintCount).to.equal(7);
      expect(decoded.createdAt).to.equal(1_700_000_000);
    });
  });

  describe("base58", () => {
    it("round-trips real pubkeys", () => {
      for (const key of [AGENT_ADDR, OWNER, OTHER_OWNER, PublicKey.default.toBase58()]) {
        expect(L.bs58Encode(pubkeyBytes(key))).to.equal(key);
      }
    });

    it("validates pubkey-shaped query parameters", () => {
      expect(L.isPubkey(AGENT_ADDR)).to.equal(true);
      expect(L.isPubkey(PublicKey.default.toBase58())).to.equal(true);
      expect(L.isPubkey("not-a-key")).to.equal(false);
      expect(L.isPubkey("")).to.equal(false);
      expect(L.isPubkey(undefined)).to.equal(false);
      // 44 chars but decodes to the wrong number of bytes.
      expect(L.isPubkey("z".repeat(44))).to.equal(false);
    });
  });

  describe("buildResponse", () => {
    function build(query: Query, stub: StubRpc): Promise<Payload> {
      return trust.buildResponse(query, { fetchImpl: stub.fetchImpl, now: NOW });
    }

    it("returns the whole registry with profiles joined", async () => {
      const stub = fullStub();
      const payload = await build({}, stub);

      expect(payload.ok).to.equal(true);
      expect(payload.counts).to.deep.equal({
        agents: 1,
        bonds: 1,
        slashes: 1,
        constraints: 1,
      });
      expect(payload.agents).to.have.length(1);
      expect(payload.agents[0].name).to.equal("atlas");
      expect(payload.agents[0].constraints).to.have.length(1);
      expect(payload.agents[0].constraints[0].type).to.equal("spend_limit");
      expect(payload.agents[0].profile.slashes).to.have.length(1);
    });

    it("reports the escrow vault", async () => {
      const payload = await build({}, fullStub());
      expect(payload.vault).to.not.equal(null);
      expect(payload.vault!.totalSlashedLamports).to.equal("1000000000");
      expect(payload.vault!.availableLamports).to.equal("1000000000");
    });

    it("publishes slash records and escrow custody side by side, and names the gap", async () => {
      // Balanced: one 1 SOL record, and the vault reports taking in 1 SOL.
      const balanced = await build({}, fullStub());
      expect(balanced.reconciliation.balanced).to.equal(true);
      expect(balanced.reconciliation.recordsSlashedLamports).to.equal("1000000000");
      expect(balanced.reconciliation.unescrowedLamports).to.equal("0");
      expect(balanced.reconciliation.unescrowedSol).to.equal(0);
      expect(balanced.warnings.join(" ")).to.not.match(/never-deposited/i);

      // Unbalanced: a second record whose lamports never entered escrow, which is
      // what this devnet deployment actually looks like — records written before
      // the program held collateral in escrow.
      const stub = new StubRpc({
        Agent: [[AGENT_ADDR, agentFixture({ name: "atlas", constraintCount: 1 })]],
        Bond: [["BondPdaPlaceholder", bondFixture({ amount: 5_000_000_000n })]],
        SlashRecord: [
          ["SlashPdaOne", slashFixture({ nonce: 1n, amount: 1_000_000_000n })],
          ["SlashPdaTwo", slashFixture({ nonce: 2n, amount: 1_000_000_000n })],
        ],
        Constraint: [["ConstraintPda", constraintFixture()]],
        Vault: [["VaultPdaPlaceholder", vaultFixture(1_000_000_000n, 0n)]],
      });
      const payload = await build({}, stub);

      expect(payload.reconciliation.recordsSlashedLamports).to.equal("2000000000");
      expect(payload.reconciliation.vaultTotalSlashedLamports).to.equal("1000000000");
      expect(payload.reconciliation.unescrowedLamports).to.equal("1000000000");
      expect(payload.reconciliation.unescrowedSol).to.equal(1);
      expect(payload.reconciliation.balanced).to.equal(false);
      expect(payload.warnings.join(" ")).to.match(/recorded-but-never-deposited/i);
    });

    it("never tells a reader escrow owes money it never received", async () => {
      const payload = await build({}, fullStub());
      const profileWarnings = payload.agents[0].profile.warnings.join(" ");
      // The chain can support "not yet compensated"; it cannot support a claim
      // that a specific amount is owed out of escrow, because slash records
      // carry no deposit.
      expect(profileWarnings).to.match(/not yet compensated/i);
      expect(profileWarnings).to.not.match(/still owed/i);
    });

    it("grades a bonded agent with one unpaid slash", async () => {
      const payload = await build({}, fullStub());
      // 100 - 10 (one slash) - 12 (unpaid) = 78 -> B
      expect(payload.agents[0].profile.score).to.equal(78);
      expect(payload.agents[0].profile.grade).to.equal("B");
      expect(payload.agents[0].profile.stats.openSlashes).to.equal(1);
    });

    it("totals bonded lamports across agents", async () => {
      const payload = await build({}, fullStub());
      expect(payload.totals.bondedLamports).to.equal("5000000000");
      expect(payload.totals.bondedSol).to.equal(5);
      expect(payload.totals.slashCount).to.equal(1);
    });

    it("is a usable registry when the program has no accounts yet", async () => {
      const payload = await build({}, new StubRpc({}));
      expect(payload.counts).to.deep.equal({
        agents: 0,
        bonds: 0,
        slashes: 0,
        constraints: 0,
      });
      expect(payload.agents).to.deep.equal([]);
      expect(payload.vault).to.equal(null);
      expect(payload.totals.bondedLamports).to.equal("0");
    });

    it("looks one agent up by address with getAccountInfo, not a full scan", async () => {
      const stub = fullStub();
      const payload = await build({ agent: AGENT_ADDR }, stub);

      expect(stub.calls[0].method).to.equal("getAccountInfo");
      expect(stub.calls[0].params[0]).to.equal(AGENT_ADDR);
      expect(payload.agents).to.have.length(1);
    });

    it("filters an agent's bond, slashes and constraints by its address at offset 8", async () => {
      const stub = fullStub();
      await build({ agent: AGENT_ADDR }, stub);

      const scans = stub.calls.filter((c) => c.method === "getProgramAccounts");
      // Bond, SlashRecord, Constraint for the one agent, then the Vault scan.
      expect(scans).to.have.length(4);

      const nested = scans.slice(0, 3).map((c) => {
        const filters = (c.params[1] as { filters: Array<{ memcmp: unknown }> }).filters;
        expect(filters).to.have.length(2);
        return filters[1].memcmp;
      });
      for (const memcmp of nested) {
        expect(memcmp).to.deep.equal({ offset: 8, bytes: AGENT_ADDR });
      }
    });

    it("returns an empty registry for an address that holds no agent", async () => {
      const payload = await build({ agent: PublicKey.default.toBase58() }, fullStub());
      expect(payload.agents).to.deep.equal([]);
      // No agent means no reason to ask about its bond, slashes or constraints.
      expect(payload.counts.bonds).to.equal(0);
      expect(payload.counts.slashes).to.equal(0);
    });

    it("filters agents by owner at the owner field offset", async () => {
      const stub = fullStub();
      const payload = await build({ owner: OWNER }, stub);

      const agentScan = stub.calls.find((c) => {
        if (c.method !== "getProgramAccounts") return false;
        const filters = (c.params[1] as { filters: Array<{ memcmp: { bytes: string } }> }).filters;
        return (
          filters[0].memcmp.bytes ===
          L.bs58Encode(Uint8Array.from(L.ACCOUNT_DISCRIMINATORS.Agent))
        );
      });
      expect(agentScan, "no agent scan was issued").to.not.equal(undefined);

      const filters = (agentScan!.params[1] as { filters: Array<{ memcmp: unknown }> }).filters;
      expect(filters[1].memcmp).to.deep.equal({ offset: L.OFFSETS.Agent.owner, bytes: OWNER });
      expect(payload.agents).to.have.length(1);
    });

    it("rejects a malformed agent address with a 400", async () => {
      try {
        await build({ agent: "lol" }, fullStub());
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as { status?: number }).status).to.equal(400);
      }
    });

    it("rejects a malformed owner address with a 400", async () => {
      try {
        await build({ owner: "lol" }, fullStub());
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as { status?: number }).status).to.equal(400);
      }
    });

    it("rejects an unknown cluster with a 400", async () => {
      try {
        await build({ cluster: "regtest" }, fullStub());
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as { status?: number }).status).to.equal(400);
        expect((error as Error).message).to.match(/unknown cluster/);
      }
    });

    it("surfaces an RPC failure instead of returning an empty registry", async () => {
      // This matters: a swallowed RPC error would render as "no agents exist",
      // which is a lie a trust product must never tell.
      const stub = fullStub();
      stub.failWith = "getProgramAccounts is disabled";
      try {
        await build({}, stub);
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as Error).message).to.match(/disabled/);
      }
    });

    it("produces JSON with no BigInt left in it", async () => {
      const payload = await build({}, fullStub());
      expect(() => JSON.stringify(payload)).to.not.throw();
      const text = JSON.stringify(payload);
      expect(text).to.contain('"bondedLamports":"5000000000"');
    });

    it("carries no program warnings when every account is v0.2 and the vault exists", async () => {
      const payload = await build({}, fullStub());
      expect(payload.warnings).to.deep.equal([]);
      expect(payload.agents[0].layout).to.equal("v2");
    });

    it("warns when the deployment predates the v0.2 layout and escrow vault", async () => {
      // This is the live devnet program's shape today: 116-byte agents and no
      // vault. A reader has to be told the numbers are partial.
      const v2 = Buffer.from(agentFixture({ name: "augur" }));
      const v1 = Buffer.concat([v2.subarray(0, 107), v2.subarray(109)]);

      const payload = await build(
        {},
        new StubRpc({
          Agent: [[AGENT_ADDR, v1]],
          Bond: [["BondPda", bondFixture({ amount: 300_000_000n })]],
        })
      );

      expect(payload.agents[0].layout).to.equal("v1");
      expect(payload.warnings.join(" ")).to.match(/v0.1 account layout/);
      expect(payload.warnings.join(" ")).to.match(/No Vault account exists/);
      // 0.3 SOL bond with no slashes: thin-bond penalty only.
      expect(payload.agents[0].profile.score).to.equal(92);
    });
  });

  describe("HTTP handler", () => {
    function makeRes() {
      const headers: Record<string, string> = {};
      let body = "";
      return {
        res: {
          statusCode: 0,
          setHeader(name: string, value: string) {
            headers[name] = value;
          },
          end(chunk?: string) {
            body = chunk || "";
          },
        },
        headers,
        bodyText: () => body,
      };
    }

    /** Run the handler against a stubbed RPC, restoring the real fetch after. */
    async function handle(query: Record<string, string>, method = "GET", stub = fullStub()) {
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = stub.fetchImpl;
      try {
        const { res, headers, bodyText } = makeRes();
        await trust({ method, query }, res);
        return { statusCode: res.statusCode, headers, body: bodyText() };
      } finally {
        (globalThis as { fetch: unknown }).fetch = originalFetch;
      }
    }

    it("answers a CORS preflight with 204", async () => {
      const { res } = makeRes();
      await trust({ method: "OPTIONS" }, res);
      expect(res.statusCode).to.equal(204);
    });

    it("rejects a non-GET method with 405", async () => {
      const { res, bodyText } = makeRes();
      await trust({ method: "POST" }, res);
      expect(res.statusCode).to.equal(405);
      expect(JSON.parse(bodyText())).to.deep.equal({
        ok: false,
        error: "method not allowed; use GET",
      });
    });

    it("returns a 502 with the RPC message when the node fails", async () => {
      const stub = fullStub();
      stub.failWith = "node is behind";
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = stub.fetchImpl;
      try {
        const { res, bodyText } = makeRes();
        await trust({ method: "GET", query: {} }, res);
        expect(res.statusCode).to.equal(502);
        expect(JSON.parse(bodyText()).error).to.match(/behind/);
      } finally {
        (globalThis as { fetch: unknown }).fetch = originalFetch;
      }
    });

    it("answers 404 for a named agent that holds no account", async () => {
      // A caller asking about one address has to be able to tell "not found"
      // from "found, with nothing at stake". Only the first is a 404.
      const out = await handle({ agent: OTHER_OWNER });
      expect(out.statusCode).to.equal(404);

      const body = JSON.parse(out.body);
      expect(body.ok).to.equal(false);
      expect(body.code).to.equal("AGENT_NOT_FOUND");
      expect(body.address).to.equal(OTHER_OWNER);
      expect(body.error).to.include(OTHER_OWNER);
      expect(out.headers["x-equxi-status"]).to.equal("unknown");
    });

    it("answers 200 for an owner with no agents, because that is an answer", async () => {
      // The distinction the 404 existence rests on: an owner address exists, it
      // simply holds no agents, so it is not a missing resource. The empty stub
      // is how "an owner with no agents" looks from the endpoint's side.
      const out = await handle({ owner: OTHER_OWNER }, "GET", new StubRpc({}));
      expect(out.statusCode).to.equal(200);
      expect(JSON.parse(out.body).counts.agents).to.equal(0);
    });

    it("answers 200 for an agent that exists, with no unknown marker", async () => {
      const out = await handle({ agent: AGENT_ADDR });
      expect(out.statusCode).to.equal(200);
      expect(JSON.parse(out.body).counts.agents).to.equal(1);
      expect(out.headers["x-equxi-status"]).to.equal(undefined);
    });
  });

  /**
   * The endpoint's upstream is not a detail: it is the same public devnet node
   * every reader shares, and it rate-limits. These pin the two behaviours that
   * keep a busy or unlucky moment from turning into a dead page.
   */
  describe("upstream resilience", () => {
    /** A fetch that records every URL it is asked for. */
    function recordingFetch(respond: (url: string, call: number) => { ok: boolean; status: number }) {
      const urls: string[] = [];
      const fetchImpl = async (url: string) => {
        urls.push(url);
        const answer = respond(url, urls.length);
        return {
          ok: answer.ok,
          status: answer.status,
          json: async () => ({ result: [] }),
        };
      };
      return { urls, fetchImpl: fetchImpl as never };
    }

    it("retries a rate-limited node once and still answers", async () => {
      const { urls, fetchImpl } = recordingFetch((_url, call) =>
        call === 1 ? { ok: false, status: 429 } : { ok: true, status: 200 }
      );

      const payload = await trust.buildResponse({}, { fetchImpl, now: NOW });

      expect(payload.ok).to.equal(true);
      // One refused call, then the retry, then the reads that follow it.
      expect(urls.length).to.be.greaterThan(2);
    });

    it("rides out a burst of rate limits instead of failing the read", async () => {
      // A targeted lookup is five `getProgramAccounts` calls in a row, and the
      // public node rate-limits that burst by the second. A single retry landed
      // inside the same window and surfaced a 502 for an agent that exists.
      const urls: string[] = [];
      let calls = 0;
      const fetchImpl = (async (url: string) => {
        urls.push(url);
        calls += 1;
        return calls <= 2
          ? { ok: false, status: 429, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ result: [] }) };
      }) as never;

      const payload = await trust.buildResponse({}, { fetchImpl, now: NOW });

      expect(payload.ok).to.equal(true);
      expect(urls.length).to.be.greaterThan(3);
    });

    it("stops at the attempt budget rather than looping on a node that stays busy", async () => {
      const urls: string[] = [];
      const fetchImpl = (async (url: string) => {
        urls.push(url);
        return { ok: false, status: 429, json: async () => ({}) };
      }) as never;

      try {
        await trust.buildResponse({}, { fetchImpl, now: NOW });
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as Error).message).to.match(/HTTP 429/);
      }

      // Three attempts against the one endpoint, then it stops. An unbounded
      // retry here would turn a busy node into a hung function.
      expect(urls.length).to.equal(3);
    });

    it("does not spend a third timeout on a node that never answered", async () => {
      // A connection that never answers has already burned the whole upstream
      // timeout, so a third attempt costs more than the function has.
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;
        throw new Error("socket hang up");
      }) as never;

      try {
        await trust.buildResponse({}, { fetchImpl, now: NOW });
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as Error).message).to.match(/hang up/);
      }
      expect(calls).to.equal(2);
    });

    it("obeys Retry-After when the node names one", async () => {
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            status: 429,
            headers: { get: (name: string) => (name === "retry-after" ? "1" : null) },
            json: async () => ({}),
          };
        }
        return { ok: true, status: 200, json: async () => ({ result: [] }) };
      }) as never;

      const started = Date.now();
      const payload = await trust.buildResponse({}, { fetchImpl, now: NOW });

      expect(payload.ok).to.equal(true);
      // A named second is waited out rather than second-guessed at 300ms.
      expect(Date.now() - started).to.be.greaterThanOrEqual(950);
    });

    it("moves to the configured fallback endpoint when the primary is down", async () => {
      const { urls, fetchImpl } = recordingFetch((url) =>
        url.includes("primary.example") ? { ok: false, status: 503 } : { ok: true, status: 200 }
      );
      const before = {
        primary: process.env.EQUXI_RPC,
        fallbacks: process.env.EQUXI_RPC_FALLBACKS,
      };
      process.env.EQUXI_RPC = "https://primary.example/rpc";
      process.env.EQUXI_RPC_FALLBACKS = "https://backup.example/rpc";

      try {
        const payload = await trust.buildResponse({}, { fetchImpl, now: NOW });
        expect(payload.ok).to.equal(true);
        expect(urls.some((url) => url.includes("backup.example"))).to.equal(true);
      } finally {
        if (before.primary === undefined) delete process.env.EQUXI_RPC;
        else process.env.EQUXI_RPC = before.primary;
        if (before.fallbacks === undefined) delete process.env.EQUXI_RPC_FALLBACKS;
        else process.env.EQUXI_RPC_FALLBACKS = before.fallbacks;
      }
    });
  });

  /**
   * When the node will not be read, the last complete registry read beats a 502
   * on a page whose whole claim is that the record is checkable — provided it
   * says so, and provided it never invents the one answer a read from minutes
   * ago cannot support: that an address does not exist.
   */
  describe("the snapshot fallback", () => {
    // Must track SNAPSHOT_TTL_S in api/trust.js.
    const TTL = 300;

    /** The same stub, but every request now fails the way a rate-limited node does. */
    function deadStub() {
      const stub = fullStub();
      stub.failWith = "getProgramAccounts failed with HTTP 429";
      return stub;
    }

    it("answers a registry read from the last complete one when the node fails", async () => {
      const live = await trust.buildResponse({}, { fetchImpl: fullStub().fetchImpl, now: NOW });
      expect(live.agents.length).to.be.greaterThan(0);

      const stale = await trust.buildResponse({}, { fetchImpl: deadStub().fetchImpl, now: NOW + 30 });

      expect(stale.stale).to.equal(true);
      expect(stale.snapshotAgeSeconds).to.equal(30);
      expect(stale.agents.length).to.equal(live.agents.length);
      expect(stale.totals.bondedLamports).to.equal(live.totals.bondedLamports);
      // A stale answer has to admit what it is, in the payload a reader sees.
      expect(stale.warnings.join(" ")).to.match(/could not be read/i);
    });

    it("answers a targeted read from the snapshot, with that agent's own totals", async () => {
      await trust.buildResponse({}, { fetchImpl: fullStub().fetchImpl, now: NOW });

      const stale = await trust.buildResponse(
        { agent: AGENT_ADDR },
        { fetchImpl: deadStub().fetchImpl, now: NOW + 10 }
      );

      expect(stale.stale).to.equal(true);
      expect(stale.agents).to.have.length(1);
      expect(stale.agents[0].address).to.equal(AGENT_ADDR);
      // The registry's numbers must not sit beside a single agent's row.
      expect(stale.counts.agents).to.equal(1);
      expect(stale.totals.bondedLamports).to.equal("5000000000");
      expect(stale.totals.slashCount).to.equal(1);
    });

    it("never turns a stale registry into a 404 for an address it never saw", async () => {
      await trust.buildResponse({}, { fetchImpl: fullStub().fetchImpl, now: NOW });

      try {
        await trust.buildResponse(
          { agent: OTHER_OWNER },
          { fetchImpl: deadStub().fetchImpl, now: NOW + 10 }
        );
        expect.fail("should have thrown");
      } catch (error) {
        // A read from minutes ago cannot tell "no such agent" from "registered
        // since", so the upstream failure is the honest answer here.
        expect((error as Error).message).to.match(/429/);
      }
    });

    it("forgets a snapshot once it is older than the window", async () => {
      await trust.buildResponse({}, { fetchImpl: fullStub().fetchImpl, now: NOW });

      try {
        await trust.buildResponse({}, { fetchImpl: deadStub().fetchImpl, now: NOW + TTL + 1 });
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as Error).message).to.match(/429/);
      }
    });

    it("is refused outright when the caller asks for a live read, as the badge does", async () => {
      await trust.buildResponse({}, { fetchImpl: fullStub().fetchImpl, now: NOW });

      try {
        await trust.buildResponse(
          {},
          { fetchImpl: deadStub().fetchImpl, now: NOW + 1, snapshot: false }
        );
        expect.fail("should have thrown");
      } catch (error) {
        // A badge advertises a fresh read; a quiet 5-minute-old grade is the
        // one thing it must never show.
        expect((error as Error).message).to.match(/429/);
      }
    });
  });

  /**
   * `?rpc=` is a development affordance, and on a deployment it was an open
   * request proxy: the server would POST wherever the query string pointed.
   * Worse for this product, a caller could name a node they control and then
   * cite an equxi URL as evidence for accounts that node invented. The gate is
   * therefore a correctness requirement, not a hardening nicety.
   */
  describe("the rpc override gate", () => {
    function recordingFetch() {
      const urls: string[] = [];
      const fetchImpl = async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => ({ result: [] }) };
      };
      return { urls, fetchImpl: fetchImpl as never };
    }

    async function messageFrom(run: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
      try {
        await run();
      } catch (error) {
        const typed = error as { status?: number; message?: string };
        return { status: typed.status, message: String(typed.message || typed) };
      }
      return { message: "no error" };
    }

    it("refuses an arbitrary rpc url on a deployment, without calling it", async () => {
      const { urls, fetchImpl } = recordingFetch();
      const before = { vercel: process.env.VERCEL, allow: process.env.EQUXI_ALLOW_RPC };
      process.env.VERCEL = "1";
      delete process.env.EQUXI_ALLOW_RPC;

      try {
        const failure = await messageFrom(() =>
          trust.buildResponse({ rpc: "http://127.0.0.1:1/" }, { fetchImpl, now: NOW })
        );
        expect(failure.status).to.equal(400);
        expect(failure.message).to.match(/disabled/);
        // The whole point: the machine the caller named was never contacted.
        expect(urls).to.deep.equal([]);
      } finally {
        if (before.vercel === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = before.vercel;
        if (before.allow !== undefined) process.env.EQUXI_ALLOW_RPC = before.allow;
      }
    });

    it("honours the override outside a deployment, for local development", async () => {
      const { urls, fetchImpl } = recordingFetch();
      const before = { vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV };
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;

      try {
        await trust.buildResponse({ rpc: "https://local.example/rpc" }, { fetchImpl, now: NOW });
        expect(urls[0]).to.equal("https://local.example/rpc");
      } finally {
        if (before.vercel !== undefined) process.env.VERCEL = before.vercel;
        if (before.vercelEnv !== undefined) process.env.VERCEL_ENV = before.vercelEnv;
      }
    });
  });
});

/**
 * The request throttle. It is the only thing standing between a client that
 * varies its query on every request and a whole-program scan per request, so
 * the two behaviours worth pinning are that it counts, and that it can never
 * be the reason a legitimate read fails.
 */
describe("request throttle (lib/rate-limit.js)", () => {
  /** A request shaped like the platform's, with a caller we control. */
  function requestFrom(ip: string) {
    return { headers: { "x-forwarded-for": ip }, socket: { remoteAddress: ip } } as never;
  }

  it("allows the budget and refuses the request after it", () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < throttle.MAX_PER_WINDOW; i++) {
      expect(throttle.limited(requestFrom(ip)), `refused request ${i + 1} of the budget`).to.equal(
        false
      );
    }
    expect(throttle.limited(requestFrom(ip))).to.equal(true);
  });

  it("counts each client separately", () => {
    const other = "203.0.113.44";
    expect(throttle.limited(requestFrom(other))).to.equal(false);
  });

  it("reads the first hop of a forwarded chain", () => {
    expect(throttle.clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } } as never)).to.equal(
      "9.9.9.9"
    );
    expect(throttle.clientIp({ headers: {} } as never)).to.equal("unknown");
  });

  it("fails open when the request carries nothing to key on", () => {
    expect(throttle.limited(null as never)).to.equal(false);
    expect(throttle.limited({} as never)).to.equal(false);
  });
});

/**
 * `GET /api/badge` — the embeddable SVG.
 *
 * A badge is read by people who never open this repository, so the two things
 * worth pinning are: it can never disagree with `GET /api/trust` about the same
 * agent, and it can never pass off an unknown address as a clean one.
 */
describe("badge API (api/badge.js)", () => {
  describe("renderBadge", () => {
    it("draws the label and value with the grade colour", () => {
      const svg = badge.renderBadge({ label: "equxi", value: "D 48", grade: "D" });
      expect(svg).to.match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).to.include(">equxi<");
      expect(svg).to.include(">D 48<");
      expect(svg).to.include("#ff5454"); // D/F are red
      expect(svg).to.include('aria-label="equxi: D 48"');
    });

    it("renders ungraded and unknown grey, never green", () => {
      for (const grade of ["ungraded", "unknown"]) {
        const svg = badge.renderBadge({ label: "equxi", value: grade, grade });
        expect(svg, grade).to.include("#6b6b6b");
        expect(svg, grade).to.not.include("#14f195");
      }
    });

    it("escapes a hostile value instead of emitting markup", () => {
      const svg = badge.renderBadge({
        label: 'x"><script>alert(1)</script>',
        value: "&#<b>",
        grade: "A",
      });
      expect(svg).to.not.include("<script");
      expect(svg).to.not.include("<b>");
      expect(svg).to.include("&lt;script&gt;");
      expect(svg).to.include("&amp;");
    });

    it("grows with the value, so the text cannot clip", () => {
      const narrow = badge.renderBadge({ label: "equxi", value: "A 100", grade: "A" });
      const wide = badge.renderBadge({
        label: "equxi",
        value: "ungraded because there is nothing at stake",
        grade: "ungraded",
      });
      const widthOf = (svg: string) => Number(svg.match(/width="(\d+)"/)?.[1]);
      expect(widthOf(wide)).to.be.greaterThan(widthOf(narrow));
    });
  });

  describe("buildBadge", () => {
    const deps = () => ({ fetchImpl: fullStub().fetchImpl, now: NOW });

    it("cannot disagree with GET /api/trust about the same agent", async () => {
      const stub = fullStub();
      const payload = await trust.buildResponse({ agent: AGENT_ADDR }, {
        fetchImpl: stub.fetchImpl,
        now: NOW,
      });
      const result = await badge.buildBadge({ agent: AGENT_ADDR }, deps());
      const profile = payload.agents[0].profile;

      expect(result.status).to.equal("graded");
      expect(result.grade).to.equal(profile.grade);
      expect(result.agent?.score).to.equal(profile.score);
      expect(result.agent?.grade).to.equal(profile.grade);
      expect(result.agent?.bondSol).to.equal(profile.bond?.amountSol);
      expect(result.agent?.slashCount).to.equal(profile.stats.slashCount);
    });

    it("reports an unknown address as unknown, not as a pass", async () => {
      const result = await badge.buildBadge(
        { agent: new PublicKey("SysvarRent111111111111111111111111111111111").toBase58() },
        deps()
      );
      expect(result.status).to.equal("unknown");
      expect(result.grade).to.equal("unknown");
      expect(result.value).to.equal("not found");
      expect(result.agent).to.equal(null);
    });

    it("rejects a missing or malformed agent address", async () => {
      async function fails(query: Record<string, string>) {
        try {
          await badge.buildBadge(query, deps());
          return null;
        } catch (error) {
          return error as Error & { status?: number };
        }
      }

      const missing = await fails({});
      expect(missing && missing.message).to.match(/agent/i);
      expect(missing && missing.status).to.equal(400);

      const malformed = await fails({ agent: "not-a-pubkey" });
      expect(malformed && malformed.message).to.match(/base58/i);
      expect(malformed && malformed.status).to.equal(400);
    });
  });

  describe("HTTP handler", () => {
    function makeRes() {
      const headers: Record<string, string> = {};
      let body = "";
      return {
        res: {
          statusCode: 0,
          setHeader(name: string, value: string) {
            headers[name] = value;
          },
          end(chunk?: string) {
            body = chunk || "";
          },
        },
        headers,
        bodyText: () => body,
      };
    }

    /** Run the handler against a stubbed RPC, restoring the real fetch after. */
    async function handle(query: Record<string, string>, method = "GET") {
      const originalFetch = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = fullStub().fetchImpl;
      try {
        const { res, headers, bodyText } = makeRes();
        await badge({ method, query }, res);
        return { statusCode: res.statusCode, headers, body: bodyText() };
      } finally {
        (globalThis as { fetch: unknown }).fetch = originalFetch;
      }
    }

    it("serves an SVG with the outcome in headers", async () => {
      const out = await handle({ agent: AGENT_ADDR });
      expect(out.statusCode).to.equal(200);
      expect(out.headers["content-type"]).to.match(/image\/svg\+xml/);
      expect(out.headers["x-equxi-status"]).to.equal("graded");
      expect(out.body).to.include("<svg");
      expect(out.headers["access-control-allow-origin"]).to.equal("*");
    });

    it("serves JSON when asked", async () => {
      const out = await handle({ agent: AGENT_ADDR, format: "json" });
      expect(out.headers["content-type"]).to.match(/application\/json/);
      const parsed = JSON.parse(out.body);
      expect(parsed.status).to.equal("graded");
      expect(parsed.agent.explorer).to.include(AGENT_ADDR);
    });

    it("marks an unknown address in the headers", async () => {
      const out = await handle({ agent: new PublicKey("SysvarRent111111111111111111111111111111111").toBase58() });
      expect(out.statusCode).to.equal(200);
      expect(out.headers["x-equxi-status"]).to.equal("unknown");
    });

    it("answers preflight with 204 and rejects other methods with 405", async () => {
      const preflight = await handle({}, "OPTIONS");
      expect(preflight.statusCode).to.equal(204);

      const posted = await handle({ agent: AGENT_ADDR }, "POST");
      expect(posted.statusCode).to.equal(405);
    });

    it("returns a 400 for a missing agent parameter", async () => {
      const out = await handle({});
      expect(out.statusCode).to.equal(400);
    });
  });
});

/* ── markets (Panta) ──────────────────────────────────────────────────── */

describe("markets API (api/markets.js)", () => {
  const NOW = 1_800_000_000;

  const ITEM = {
    marketId: "mkt_ed_1",
    category: "sports",
    title: "Will Example United win the derby?",
    description: "Resolves YES if Example United wins on matchday.",
    images: ["https://cdn.panta.market/x.png"],
    phase: "primary",
    marketType: "binary",
    startTime: "2026-10-01T00:00:00Z",
    endTime: "2026-10-11T00:00:00Z",
    resolutionTime: "2026-10-12T00:00:00Z",
    region: "global",
    resolved: false,
    status: "open",
    volumeUsdc: "1234.56",
    campaignId: null,
    createdByPartner: true,
    yesPrice: null,
    noPrice: null,
    // A field this API does not document must not leak into the output.
    internalRiskScore: 99,
  };

  interface Call {
    url: string;
    init: { method: string; headers: Record<string, string>; signal?: unknown };
  }

  // Local alias on purpose: a default import does not bind the namespace types.
  // `any` on the decoded body on purpose: the stub returns whatever body the
  // test wants, and the real declaration narrows it at the call site.
  type PantaFetch = (
    url: string,
    init: Call["init"]
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

  function pantaFetch(
    calls: Call[],
    response: { ok?: boolean; status?: number; body?: unknown } = {}
  ): PantaFetch {
    const status = response.status ?? 200;
    const ok = response.ok ?? (status >= 200 && status < 300);
    return (async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      return {
        ok,
        status,
        json: async () =>
          response.body !== undefined ? response.body : { items: [ITEM], nextCursor: "cursor_2" },
      };
    }) as PantaFetch;
  }

  const deps = (
    calls: Call[],
    apiKey = "pk_test_abc",
    response?: { ok?: boolean; status?: number; body?: unknown }
  ) => ({ fetchImpl: pantaFetch(calls, response), now: NOW, apiKey });

  /** A 44-char base58 string that passes the address check. */
  const ADDRESS = "D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc";

  // The payload is a union discriminated by `mode`, and a default import does
  // not bind the namespace types, so narrow with `Extract` instead of naming
  // `markets.ListPayload` and friends.
  function asList<T extends { mode: string }>(p: T): Extract<T, { mode: "list" }> {
    if (p.mode !== "list") throw new Error("expected a list payload");
    return p as Extract<T, { mode: "list" }>;
  }
  function asMarket<T extends { mode: string }>(p: T): Extract<T, { mode: "market" }> {
    if (p.mode !== "market") throw new Error("expected a market payload");
    return p as Extract<T, { mode: "market" }>;
  }
  function asPositions<T extends { mode: string }>(p: T): Extract<T, { mode: "positions" }> {
    if (p.mode !== "positions") throw new Error("expected a positions payload");
    return p as Extract<T, { mode: "positions" }>;
  }

  it("states that the feed is unconfigured instead of failing or inventing data", async () => {
    const calls: Call[] = [];
    const payload = asList(await markets.buildResponse({}, deps(calls, "")));

    expect(payload.mode).to.equal("list");
    expect(payload.configured).to.equal(false);
    expect(payload.sandbox).to.equal(false);
    expect(payload.markets).to.deep.equal([]);
    expect(payload.counts.markets).to.equal(0);
    expect(payload.note).to.include("PANTA_API_KEY");
    expect(payload.attribution).to.equal("Powered by Panta");
    expect(calls.length).to.equal(0); // It must not call Panta without a key.
  });

  it("calls the trailing-slash route with the key header and normalizes items", async () => {
    const calls: Call[] = [];
    const payload = asList(await markets.buildResponse({}, deps(calls)));

    expect(calls.length).to.equal(1);
    expect(calls[0].url).to.equal("https://live-api.panta.market/api/v1/markets/");
    expect(calls[0].init.headers["X-Api-Key"]).to.equal("pk_test_abc");
    expect(payload.configured).to.equal(true);
    expect(payload.sandbox).to.equal(true);
    expect(payload.disclaimer).to.equal(null);
    expect(payload.attribution).to.equal("Powered by Panta");
    expect(payload.counts.markets).to.equal(1);
    expect(payload.nextCursor).to.equal("cursor_2");
    expect(payload.markets[0].marketId).to.equal("mkt_ed_1");
    expect(payload.markets[0].phase).to.equal("primary");
    expect(payload.markets[0].volumeUsdc).to.equal("1234.56");
    expect("internalRiskScore" in payload.markets[0]).to.equal(false);
  });

  it("reads one market's detail route, where the list leaves prices null", async () => {
    const calls: Call[] = [];
    const detail = {
      ...ITEM,
      yesPrice: "0.52",
      noPrice: "0.48",
      primaryYesPrice: "0.52",
      primaryNoPrice: "0.48",
      secondaryYesPrice: null,
      secondaryNoPrice: null,
    };

    const payload = asMarket(
      await markets.buildResponse({ market: ADDRESS }, deps(calls, "pk_live_xyz", { body: detail }))
    );

    expect(calls.length).to.equal(1);
    expect(calls[0].url).to.equal(
      "https://live-api.panta.market/api/v1/markets/" + ADDRESS + "/"
    );
    expect(calls[0].init.headers["X-Api-Key"]).to.equal("pk_live_xyz");
    expect(payload.mode).to.equal("market");
    expect(payload.sandbox).to.equal(false);
    expect(payload.market!.marketId).to.equal("mkt_ed_1");
    expect(payload.prices!.yes).to.equal("0.52");
    expect(payload.prices!.secondaryYes).to.equal(null);
    // The detail row is normalized too: an undocumented vendor field stays out.
    expect("internalRiskScore" in payload.market!).to.equal(false);
  });

  it("reads a wallet's positions, including claim eligibility and outcome", async () => {
    const calls: Call[] = [];
    const body = {
      wallet: ADDRESS,
      positions: [
        {
          marketId: "mkt_ed_1",
          category: "crypto",
          side: "yes",
          shares: "38.40",
          phase: "primary",
          claimable: false,
          claimed: false,
          outcome: null,
          internalNote: "must not ship",
        },
        {
          marketId: "mkt_ed_2",
          category: null,
          side: "no",
          shares: "5.00",
          phase: "resolved",
          claimable: true,
          claimed: false,
          outcome: "yes",
        },
      ],
    };

    const payload = asPositions(
      await markets.buildResponse({ wallet: ADDRESS }, deps(calls, "pk_live_xyz", { body }))
    );

    expect(calls[0].url).to.equal(
      "https://live-api.panta.market/api/v1/positions/?wallet=" + ADDRESS
    );
    expect(payload.mode).to.equal("positions");
    expect(payload.wallet).to.equal(ADDRESS);
    expect(payload.counts.positions).to.equal(2);
    expect(payload.positions[1].claimable).to.equal(true);
    expect(payload.positions[1].outcome).to.equal("yes");
    expect("internalNote" in payload.positions[0]).to.equal(false);
  });

  it("rejects a malformed market or wallet before spending an upstream call", async () => {
    for (const query of [{ market: "not-an-address" }, { wallet: "short" }]) {
      const calls: Call[] = [];
      try {
        await markets.buildResponse(query, deps(calls));
        expect.fail("should have thrown");
      } catch (error) {
        expect((error as Error & { status?: number }).status).to.equal(400);
      }
      expect(calls.length).to.equal(0);
    }
  });

  it("maps MARKET_NOT_FOUND to 404 and keeps the other codes meaningful", async () => {
    async function codeStatus(body: unknown, httpStatus: number) {
      try {
        await markets.buildResponse(
          { market: ADDRESS },
          deps([], "pk_live_xyz", { ok: false, status: httpStatus, body })
        );
        return null;
      } catch (error) {
        return (error as Error & { status?: number }).status ?? null;
      }
    }

    expect(await codeStatus({ error: "MARKET_NOT_FOUND" }, 404)).to.equal(404);
    expect(await codeStatus({ error: "RATE_LIMITED" }, 429)).to.equal(429);
    expect(await codeStatus({ error: "UNAUTHORIZED" }, 401)).to.equal(502);
  });

  it("treats a malformed market or position body as a broken read, not as empty data", async () => {
    async function bodyStatus(query: Record<string, string>, body: unknown) {
      try {
        await markets.buildResponse(query, deps([], "pk_live_xyz", { body }));
        return null;
      } catch (error) {
        return (error as Error & { status?: number }).status ?? null;
      }
    }

    expect(await bodyStatus({ market: ADDRESS }, { title: "no market id" })).to.equal(502);
    expect(await bodyStatus({ wallet: ADDRESS }, { wallet: ADDRESS })).to.equal(502);
  });

  it("says an unconfigured feed is off in every mode", async () => {
    const calls: Call[] = [];

    const market = asMarket(await markets.buildResponse({ market: ADDRESS }, deps(calls, "")));
    expect(market.mode).to.equal("market");
    expect(market.configured).to.equal(false);
    expect(market.market).to.equal(null);

    const positions = asPositions(
      await markets.buildResponse({ wallet: ADDRESS }, deps(calls, ""))
    );
    expect(positions.mode).to.equal("positions");
    expect(positions.configured).to.equal(false);
    expect(positions.positions).to.deep.equal([]);
    expect(positions.counts.positions).to.equal(0);

    expect(calls.length).to.equal(0); // No key, no upstream call, in any mode.
  });

  it("labels a pk_test_ key as a sandbox and passes Panta's disclaimer through", async () => {
    const calls: Call[] = [];
    const sandboxed = await markets.buildResponse(
      {},
      deps(calls, "pk_test_abc", {
        body: {
          items: [ITEM],
          nextCursor: null,
          disclaimer:
            "Test mode: this response uses sandbox fixtures and does not access Solana mainnet.",
        },
      })
    );

    expect(sandboxed.sandbox).to.equal(true);
    expect(sandboxed.disclaimer).to.include("sandbox fixtures");

    // A live key is not labelled as a sandbox, even if Panta sends no
    // disclaimer of its own.
    const live = await markets.buildResponse({}, deps([], "pk_live_xyz"));
    expect(live.sandbox).to.equal(false);
    expect(live.disclaimer).to.equal(null);
  });

  it("forwards the allow-listed params and clamps limit to 50", async () => {
    const calls: Call[] = [];
    await markets.buildResponse(
      { category: "sports", status: "open", createdBy: "me", cursor: "c1", limit: "999" },
      deps(calls)
    );

    expect(calls[0].url).to.equal(
      "https://live-api.panta.market/api/v1/markets/?category=sports&status=open&createdBy=me&cursor=c1&limit=50"
    );
  });

  it("rejects a non-numeric limit before calling upstream", async () => {
    const calls: Call[] = [];
    try {
      await markets.buildResponse({ limit: "zero" }, deps(calls));
      expect.fail("should have thrown");
    } catch (error) {
      const typed = error as Error & { status?: number };
      expect(typed.status).to.equal(400);
      expect(typed.message).to.include("limit");
    }
    expect(calls.length).to.equal(0);
  });

  it("keeps Panta's error meaning: 429 rate limit, 400 bad params, 502 rejected key", async () => {
    async function statusFor(body: unknown, httpStatus: number) {
      try {
        await markets.buildResponse({}, deps([], "pk_test_abc", { ok: false, status: httpStatus, body }));
        return null;
      } catch (error) {
        return (error as Error & { status?: number }).status ?? null;
      }
    }

    expect(await statusFor({ error: "RATE_LIMITED" }, 429)).to.equal(429);
    expect(await statusFor({ error: "INVALID_MARKET_PARAMS" }, 422)).to.equal(400);
    expect(await statusFor({ error: "UNAUTHORIZED" }, 401)).to.equal(502);
  });

  it("treats a 200 without an items array as a broken read, not as empty data", async () => {
    async function failure(body: unknown) {
      try {
        await markets.buildResponse({}, deps([], "pk_test_abc", { body }));
        return null;
      } catch (error) {
        return error as Error & { status?: number };
      }
    }

    const missing = await failure({});
    expect(missing && missing.status).to.equal(502);
    expect(missing && missing.message).to.include("malformed");

    const wrongType = await failure({ items: "nope" });
    expect(wrongType && wrongType.status).to.equal(502);
  });

  it("answers the handler with 200 and x-equxi-configured when no key is set", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.PANTA_API_KEY;
    delete process.env.PANTA_API_KEY;
    (globalThis as { fetch: unknown }).fetch = pantaFetch([]);
    try {
      const headers: Record<string, string> = {};
      let body = "";
      await markets(
        { method: "GET", query: {} },
        {
          statusCode: 0,
          setHeader(name: string, value: string) {
            headers[name] = value;
          },
          end(chunk?: string) {
            body = chunk || "";
          },
        }
      );

      const parsed = JSON.parse(body);
      expect(parsed.configured).to.equal(false);
      expect(headers["x-equxi-configured"]).to.equal("false");
      expect(headers["content-type"]).to.match(/application\/json/);
    } finally {
      (globalThis as { fetch: unknown }).fetch = originalFetch;
      if (originalKey !== undefined) process.env.PANTA_API_KEY = originalKey;
    }
  });
});

/* ── health ───────────────────────────────────────────────────────────── */

/**
 * `GET /api/health` is the one endpoint that answers *is the read path up?*
 * rather than *what is the state?*. Its two jobs are to say so honestly when
 * the node does not answer, and to name the Panta feed this deployment is
 * wired to without ever echoing the key.
 */
describe("health API (api/health.js)", () => {
  function makeRes() {
    const headers: Record<string, string> = {};
    let body = "";
    return {
      res: {
        statusCode: 0,
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
        end(chunk?: string) {
          body = chunk || "";
        },
      },
      headers,
      bodyText: () => body,
    };
  }

  /** A fetch that answers one JSON-RPC call the way the test asks it to. */
  type RpcFetch = () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

  async function handle(rpc: RpcFetch, query: Record<string, string> = {}) {
    const originalFetch = globalThis.fetch;
    const before = {
      rpc: process.env.EQUXI_RPC,
      cluster: process.env.EQUXI_CLUSTER,
    };
    // Deterministic host: the assertion below is about what health reports, not
    // about whatever endpoint this machine happens to prefer.
    delete process.env.EQUXI_RPC;
    delete process.env.EQUXI_CLUSTER;
    (globalThis as { fetch: unknown }).fetch = rpc;
    try {
      const { res, headers, bodyText } = makeRes();
      await health({ method: "GET", query }, res);
      return { statusCode: res.statusCode, headers, body: JSON.parse(bodyText()) };
    } finally {
      (globalThis as { fetch: unknown }).fetch = originalFetch;
      if (before.rpc === undefined) delete process.env.EQUXI_RPC;
      else process.env.EQUXI_RPC = before.rpc;
      if (before.cluster === undefined) delete process.env.EQUXI_CLUSTER;
      else process.env.EQUXI_CLUSTER = before.cluster;
    }
  }

  it("reports the upstream host, the slot and the latency when the node answers", async () => {
    const out = await handle(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: 508_100_000 }),
    }));

    expect(out.statusCode).to.equal(200);
    expect(out.body.ok).to.equal(true);
    expect(out.body.upstream.reachable).to.equal(true);
    expect(out.body.upstream.slot).to.equal(508_100_000);
    expect(out.body.upstream.host).to.equal("api.devnet.solana.com");
    expect(out.body.upstream.latencyMs).to.be.a("number");
    expect(out.headers["cache-control"]).to.equal("no-store");
    // Host only: a paid provider's URL can carry a key in its path.
    expect(JSON.stringify(out.body)).to.not.include("https://");
  });

  it("answers 503 naming the reason when the node does not answer", async () => {
    const out = await handle(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    expect(out.statusCode).to.equal(503);
    expect(out.body.ok).to.equal(false);
    expect(out.body.upstream.reachable).to.equal(false);
    expect(out.body.upstream.error).to.be.a("string");
  });

  it("names the build it came from, so a stale deployment is visible", async () => {
    const before = {
      sha: process.env.VERCEL_GIT_COMMIT_SHA,
      github: process.env.GITHUB_SHA,
    };
    try {
      process.env.VERCEL_GIT_COMMIT_SHA = "2ef1da0123456789abcdef0123456789abcdef01";
      delete process.env.GITHUB_SHA;
      const deployed = await handle(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: 1 }),
      }));
      expect(deployed.body.commit).to.equal("2ef1da0");

      // Off a deployment there is no commit to name, and it must say so rather
      // than invent one or claim the local tree is production.
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      const local = await handle(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: 1 }),
      }));
      expect(local.body.commit).to.equal(null);
    } finally {
      if (before.sha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = before.sha;
      if (before.github === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = before.github;
    }
  });

  it("names a sandbox Panta feed without leaking the key", async () => {
    const key = "pk_test_unit_only";
    const before = process.env.PANTA_API_KEY;
    process.env.PANTA_API_KEY = key;
    try {
      const out = await handle(async () => ({ ok: true, status: 200, json: async () => ({ result: 1 }) }));
      expect(out.body.feeds.panta).to.deep.equal({ configured: true, sandbox: true });
      expect(JSON.stringify(out.body)).to.not.include(key);
    } finally {
      if (before === undefined) delete process.env.PANTA_API_KEY;
      else process.env.PANTA_API_KEY = before;
    }
  });

  it("answers a preflight with 204 and other methods with 405", async () => {
    const { res: preflight } = makeRes();
    await health({ method: "OPTIONS" }, preflight);
    expect(preflight.statusCode).to.equal(204);

    const { res: posted, bodyText } = makeRes();
    await health({ method: "POST" }, posted);
    expect(posted.statusCode).to.equal(405);
    expect(JSON.parse(bodyText()).error).to.match(/GET/);
  });
});

/* ── access log ───────────────────────────────────────────────────────── */

/**
 * The access log is the deployment's only usage signal, and its one hard rule
 * is that it can never change an answer: a request must succeed whether or not
 * a line could be written.
 */
describe("access log (lib/log.js)", () => {
  const ORIGINAL = {
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    log: process.env.EQUXI_LOG,
  };

  function restore() {
    if (ORIGINAL.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = ORIGINAL.vercel;
    if (ORIGINAL.vercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL.vercelEnv;
    if (ORIGINAL.log === undefined) delete process.env.EQUXI_LOG;
    else process.env.EQUXI_LOG = ORIGINAL.log;
  }

  it("is silent unless a deployment or EQUXI_LOG asks for it", () => {
    try {
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.EQUXI_LOG;
      expect(log.enabled()).to.equal(false);

      process.env.EQUXI_LOG = "1";
      expect(log.enabled()).to.equal(true);

      delete process.env.EQUXI_LOG;
      process.env.VERCEL = "1";
      expect(log.enabled()).to.equal(true);

      process.env.EQUXI_LOG = "0";
      expect(log.enabled()).to.equal(false);
    } finally {
      restore();
    }
  });

  it("writes exactly one line per response, with the status and the latency", () => {
    process.env.EQUXI_LOG = "1";
    const lines: string[] = [];
    const originalConsoleLog = console.log;
    (console as { log: unknown }).log = (chunk: string) => lines.push(chunk);
    try {
      const res = { statusCode: 200, end: (_chunk?: string) => undefined };
      log.track("trust", { method: "GET", query: { cluster: "devnet", agent: AGENT_ADDR } }, res);
      res.statusCode = 404;
      res.end("{}");
      res.end("{}"); // A second end must not log a second line.

      expect(lines).to.have.length(1);
      const line = JSON.parse(lines[0]);
      expect(line.route).to.equal("trust");
      expect(line.method).to.equal("GET");
      expect(line.status).to.equal(404);
      expect(line.cluster).to.equal("devnet");
      expect(line.target).to.equal(AGENT_ADDR);
      expect(line.ms).to.be.a("number");
    } finally {
      (console as { log: unknown }).log = originalConsoleLog;
      restore();
    }
  });

  it("cannot fail a request when there is nothing to log onto", () => {
    process.env.EQUXI_LOG = "1";
    try {
      expect(() => log.track("health", null, null)).to.not.throw();
      expect(() => log.track("health", {}, {} as never)).to.not.throw();
      expect(() =>
        log.track("health", {} as never, { statusCode: 200, end: "not a function" } as never)
      ).to.not.throw();
    } finally {
      restore();
    }
  });
});
