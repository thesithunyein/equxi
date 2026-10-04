/**
 * Panta flow tests — no network, no key, no USDC.
 *
 * `lib/panta.js` is the client for the sidetrack's core artifact (an agent-risk
 * market whose resolution source is the Equxi program). The routes, bodies and
 * headers here are the ones Panta's docs specify; a drift in any of them would
 * only surface as a 4xx in production, so they are pinned instead.
 */
import { expect } from "chai";

// Default import on purpose: the module is CommonJS (`module.exports = ...`).
import panta from "../../lib/panta";

type Call = {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string; signal?: unknown };
};

type StubFetch = (
  url: string,
  init: Call["init"]
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

function stub(calls: Call[], payload: unknown = {}, opts: { ok?: boolean; status?: number } = {}): StubFetch {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return (async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    return { ok, status, json: async () => payload };
  }) as StubFetch;
}

const KEY = "pk_test_abc";
const WALLET = "Creator1111111111111111111111111111111";
const AGENT = "8ayw4XbkUZzBkTox6xomAkJ4gNT97He35GSpE3K5eZbH";

describe("panta flows (lib/panta.js)", () => {
  it("quotes a market on the documented route with the key header", async () => {
    const calls: Call[] = [];
    await panta.quoteMarketCreate(stub(calls, { createId: "cr_1", paymentUsdc: "50000000" }), KEY, {
      wallet: WALLET,
      question: "q",
      resolutionRule: "r",
      sourcesOfTruth: ["https://equxi.sithunyein.com/api/trust"],
      category: "crypto",
      startTime: 1,
      endTime: 2,
      resolutionTime: 3,
      imageUrl: "https://equxi.sithunyein.com/assets/logo.webp",
    });

    expect(calls.length).to.equal(1);
    expect(calls[0].url).to.equal("https://live-api.panta.market/api/v1/markets/create/quote/");
    expect(calls[0].init.method).to.equal("POST");
    expect(calls[0].init.headers["X-Api-Key"]).to.equal(KEY);
    const body = JSON.parse(calls[0].init.body || "{}");
    expect(body.wallet).to.equal(WALLET);
    expect(body.imageUrl).to.include("logo.webp");
  });

  it("builds and registers on the documented routes", async () => {
    const buildCalls: Call[] = [];
    await panta.buildMarketCreate(stub(buildCalls, { transaction: "base64" }), KEY, {
      createId: "cr_1",
      wallet: WALLET,
    });
    expect(buildCalls[0].url).to.equal("https://live-api.panta.market/api/v1/markets/create/build/");
    expect(JSON.parse(buildCalls[0].init.body || "{}")).to.deep.equal({ createId: "cr_1", wallet: WALLET });

    const registerCalls: Call[] = [];
    await panta.registerMarket(stub(registerCalls, { marketId: "evt_1" }), KEY, {
      createId: "cr_1",
      signature: "sig",
    });
    expect(registerCalls[0].url).to.equal("https://live-api.panta.market/api/v1/markets/register/");
    expect(JSON.parse(registerCalls[0].init.body || "{}")).to.deep.equal({ createId: "cr_1", signature: "sig" });
  });

  it("walks the whole primary-buy flow on the documented routes", async () => {
    const quoteCalls: Call[] = [];
    await panta.quotePrimaryBuy(stub(quoteCalls, { quoteId: "qt_1" }), KEY, {
      wallet: WALLET,
      marketId: "evt_1",
      side: "yes",
      amountUsdc: "20.00",
      userId: "equxi",
    });
    expect(quoteCalls[0].url).to.equal("https://live-api.panta.market/api/v1/primaryorderquote/");
    expect(JSON.parse(quoteCalls[0].init.body || "{}").amountUsdc).to.equal("20.00");

    const buildCalls: Call[] = [];
    await panta.buildPrimaryBuy(stub(buildCalls, { orderId: "ord_1" }), KEY, {
      quoteId: "qt_1",
      wallet: WALLET,
      userId: "equxi",
      maxSlippageBps: 100,
    });
    expect(buildCalls[0].url).to.equal("https://live-api.panta.market/api/v1/primaryorderbuild/");
    expect(JSON.parse(buildCalls[0].init.body || "{}").maxSlippageBps).to.equal(100);

    const submitCalls: Call[] = [];
    await panta.submitPrimaryBuy(stub(submitCalls, { status: "submitted" }), KEY, {
      orderId: "ord_1",
      signature: "sig",
      wallet: WALLET,
    });
    expect(submitCalls[0].url).to.equal("https://live-api.panta.market/api/v1/primaryordersubmit/");

    const reportCalls: Call[] = [];
    await panta.reportTrade(stub(reportCalls, { status: "processed" }), KEY, {
      signature: "sig",
      wallet: WALLET,
      marketId: "evt_1",
    });
    expect(reportCalls[0].url).to.equal("https://live-api.panta.market/api/v1/trades/");
  });

  it("keeps Panta's failure code and HTTP status", async () => {
    async function failure(body: unknown, status: number) {
      try {
        await panta.quotePrimaryBuy(stub([], body, { ok: false, status }), KEY, {
          wallet: WALLET,
          marketId: "evt_1",
          side: "yes",
          amountUsdc: "20.00",
        });
        return null;
      } catch (error) {
        return error as Error & { code?: string; status?: number };
      }
    }

    const rate = await failure({ code: "RATE_LIMITED", message: "slow down" }, 429);
    expect(rate && rate.code).to.equal("RATE_LIMITED");
    expect(rate && rate.status).to.equal(429);
    expect(rate && rate.message).to.include("slow down");

    const auth = await failure({ code: "UNAUTHORIZED" }, 401);
    expect(auth && auth.code).to.equal("UNAUTHORIZED");
    expect(auth && auth.status).to.equal(401);
  });

  it("plans a mechanical, public resolution rule for one agent", () => {
    const now = 1_800_000_000;
    const resolveBy = now + 30 * 24 * 3600;
    const plan = panta.agentMarketPlan({
      now,
      resolveBy,
      resolveByLabel: "2026-11-15",
      agentAddress: AGENT,
      agentName: "Witness141106",
    });

    expect(plan.question).to.include("Witness141106");
    expect(plan.question).to.include(AGENT);
    expect(plan.resolutionRule).to.include("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");
    expect(plan.sourcesOfTruth[0]).to.equal(
      "https://equxi.sithunyein.com/api/trust?agent=" + AGENT
    );
    expect(plan.sourcesOfTruth.length).to.equal(2);

    // Panta's documented constraints: start >= now + ~3600s, start < end <= resolution.
    expect(plan.startTime).to.be.at.least(now + panta.MIN_START_DELAY_SECONDS);
    expect(plan.startTime).to.be.below(plan.endTime);
    expect(plan.endTime).to.be.at.most(plan.resolutionTime);
    expect(plan.marketType).to.equal("standard");
    expect(panta.CATEGORIES).to.contain(plan.category);
  });

  it("refuses a resolution date inside Panta's minimum start delay", () => {
    expect(() =>
      panta.agentMarketPlan({
        now: 1_800_000_000,
        resolveBy: 1_800_000_100,
        resolveByLabel: "soon",
        agentAddress: AGENT,
      })
    ).to.throw(/minimum start delay/);
  });

  it("rejects a category Panta does not accept", () => {
    expect(() =>
      panta.agentMarketPlan({
        now: 1_800_000_000,
        resolveBy: 1_800_000_000 + 30 * 24 * 3600,
        resolveByLabel: "later",
        agentAddress: AGENT,
        category: "lottery",
      })
    ).to.throw(/category/);
  });
});
