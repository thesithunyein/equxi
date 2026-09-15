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
import trust from "../../api/trust";

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
