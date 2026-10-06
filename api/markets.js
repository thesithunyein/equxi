/**
 * `GET /api/markets` — prediction markets, read live from Panta.
 *
 * Equxi's claim is that an agent's collateral is at risk and its record is
 * readable. A market listing is the other half of that: what an agent actually
 * trades. This endpoint pulls the operator's own markets from Panta's live API
 * and normalizes them, so the Explorer (or a judge with `curl`) can see them
 * without a wallet or a Panta account.
 *
 * ## Design constraints, and why the code looks like this
 *
 * * **No dependencies.** Same rule as `api/trust.js`: `vercel.json` sets
 *   `"buildCommand": null`, so nothing bundles this. Node standard library only.
 * * **`fetch` is injected.** `tests/unit/api.test.ts` drives every path —
 *   pass-through, clamping, upstream error codes — with a stub, no network.
 * * **The key is optional, and its absence is stated, not hidden.** With no
 *   `PANTA_API_KEY` set, the endpoint still answers 200 with
 *   `configured: false` and an explanatory `note`, rather than a 500 that looks
 *   like an outage or a fabricated empty list that looks like data.
 * * **A test key is labelled as a sandbox.** Panta answers a `pk_test_…` key
 *   with fixtures that never touch Solana mainnet, so the payload carries
 *   `sandbox: true` and passes Panta's own `disclaimer` through verbatim. A
 *   fixture that reads as a live market is a lie about the data; the Explorer
 *   renders the label instead of hiding it.
 * * **Panta errors keep their meaning.** `RATE_LIMITED` becomes a 429 so
 *   callers back off; `INVALID_MARKET_PARAMS` becomes a 400; a rejected key
 *   (`UNAUTHORIZED`) becomes a 502, because that is this deployment's config
 *   fault, not the caller's.
 *
 * ## Modes
 *
 * The endpoint answers three documented Panta reads, chosen by query:
 *
 * | Query | Panta route | Answers |
 * |-------|-------------|---------|
 * | *(none)* | `GET /markets/` | The catalog list, with cursor paging |
 * | `market=<marketId>` | `GET /markets/{marketId}/` | One market, with the spot `yesPrice` / `noPrice` the list leaves `null` |
 * | `wallet=<pubkey>` | `GET /positions/?wallet=` | That wallet's holdings: `side`, `shares`, `claimable`, `claimed`, `outcome` |
 *
 * Panta's own documentation pairs the last two: positions carry share quantity
 * and claim eligibility, the market detail carries the price to value them
 * (`shares × side price`). Serving both here means a reader can price a holding
 * without a wallet, an SDK, or a Panta account.
 *
 * ## Query parameters (list mode, forwarded to Panta)
 *
 * | Param | Meaning |
 * |-------|---------|
 * | `category` | Filter by category |
 * | `status` | Filter by status |
 * | `createdBy=me` | Only markets created by this API key's account |
 * | `cursor` | Pagination cursor from a previous response |
 * | `limit` | Page size, 1–50 (larger values are clamped to 50) |
 *
 * ## Environment
 *
 * `PANTA_API_KEY` — a `pk_test_…` key from Panta. Without it the feed is
 * disabled; with it, this endpoint never custodies or signs anything, exactly
 * like Panta's own quote → build → sign → broadcast flow expects.
 */
"use strict";

var throttle = require("../lib/rate-limit.js");
var log = require("../lib/log.js");

/** Panta's live API. Its router requires the trailing slash on every route. */
var PANTA_BASE = "https://live-api.panta.market/api/v1";

/** Only these query params are forwarded; Panta validates their values. */
var PASS_THROUGH = ["category", "status", "createdBy", "cursor", "limit"];

var MIN_LIMIT = 1;
var MAX_LIMIT = 50; // Panta's documented page-size ceiling.

/** Public reads may be cached; markets move, but the partner should not be hammered. */
var CACHE_SECONDS = 30;

/** Serve the cached copy while the next one is fetched, so expiry is invisible. */
var STALE_SECONDS = 300;

/** Upstream reads get a hard ceiling so a hung partner cannot hang the API. */
var UPSTREAM_TIMEOUT_MS = 8000;

/** Normalize one Panta market. Unknown fields are dropped, known ones kept as-is. */
function normalizeMarket(item) {
  return {
    marketId: item.marketId,
    title: item.title,
    description: item.description,
    category: item.category,
    marketType: item.marketType,
    phase: item.phase,
    resolved: item.resolved,
    status: item.status,
    startTime: item.startTime,
    endTime: item.endTime,
    resolutionTime: item.resolutionTime,
    region: item.region,
    volumeUsdc: item.volumeUsdc,
    yesPrice: item.yesPrice,
    noPrice: item.noPrice,
    campaignId: item.campaignId,
    createdByPartner: item.createdByPartner,
    images: item.images,
  };
}

/** Build the upstream URL, forwarding only allow-listed params. */
function pantaUrl(query) {
  var params = [];
  for (var i = 0; i < PASS_THROUGH.length; i++) {
    var key = PASS_THROUGH[i];
    var value = query[key];
    if (value === undefined || value === null || value === "") continue;

    if (key === "limit") {
      var limit = Math.floor(Number(value));
      if (!isFinite(limit) || limit < MIN_LIMIT) {
        throw Object.assign(new Error("limit must be a positive integer"), { status: 400 });
      }
      value = String(Math.min(limit, MAX_LIMIT));
    }
    params.push(key + "=" + encodeURIComponent(value));
  }
  return PANTA_BASE + "/markets/" + (params.length ? "?" + params.join("&") : "");
}

/** Route for one market's detail row: the spot prices the list route omits. */
function marketDetailUrl(marketId) {
  return PANTA_BASE + "/markets/" + encodeURIComponent(marketId) + "/";
}

/**
 * Route for a wallet's holdings. Panta pairs this with the detail route above:
 * a position carries `shares` and `claimable`, the market carries the price.
 */
function positionsUrl(wallet) {
  return PANTA_BASE + "/positions/?wallet=" + encodeURIComponent(wallet);
}

/**
 * A Solana address: base58, 32–44 characters. Checked before we spend an
 * upstream call, so a typo is a 400 from us, not a partner error we relay.
 */
function isAddress(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/** Normalize one Panta position row. Unknown fields are dropped, as with markets. */
function normalizePosition(item) {
  return {
    marketId: item.marketId,
    category: item.category,
    side: item.side,
    shares: item.shares,
    phase: item.phase,
    claimable: item.claimable,
    claimed: item.claimed,
    outcome: item.outcome,
  };
}

/** Map Panta's error codes onto the HTTP status this API should answer with. */
function statusForCode(code) {
  if (code === "INVALID_MARKET_PARAMS") return 400;
  if (code === "RATE_LIMITED") return 429;
  if (code === "MARKET_NOT_FOUND") return 404;
  return 502; // UNAUTHORIZED and anything unrecognised are upstream faults here.
}

/** One authenticated GET against Panta, with its error codes kept intact. */
async function pantaGet(url, deps) {
  var init = {
    method: "GET",
    headers: { "X-Api-Key": deps.apiKey, accept: "application/json" },
  };
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  }

  var response;
  try {
    response = await deps.fetchImpl(url, init);
  } catch (error) {
    throw Object.assign(new Error("Panta API unreachable: " + ((error && error.message) || error)), {
      status: 502,
    });
  }

  var payload = null;
  try {
    payload = await response.json();
  } catch (ignored) {
    payload = null;
  }

  if (!response.ok) {
    var code = (payload && (payload.error || payload.code)) || "HTTP " + response.status;
    throw Object.assign(new Error("Panta API error: " + code), {
      status: statusForCode(String(code)),
    });
  }
  if (payload === null) {
    throw Object.assign(new Error("Panta API returned an unreadable body"), { status: 502 });
  }
  return payload;
}

/**
 * Build the JSON payload. Separated from the HTTP handler so the tests can
 * assert on it directly. `deps` = `{ fetchImpl, now, apiKey }`.
 */
async function buildResponse(query, deps) {
  var now = deps.now;
  var q = query || {};
  var mode = q.market ? "market" : q.wallet ? "positions" : "list";

  // A `pk_test_` key is Panta's sandbox: fixtures only, never mainnet. Every
  // mode says which one it read in, so a visitor cannot mistake a fixture for a
  // live market, and Panta's own disclaimer ships verbatim.
  var sandbox = /^pk_test_/.test(deps.apiKey || "");

  if (!deps.apiKey) {
    var off = {
      ok: true,
      configured: false,
      sandbox: false,
      source: "panta",
      // Required by Panta's Terms of Use wherever Panta-powered functionality
      // appears; the Explorer renders it on the markets card.
      attribution: "Powered by Panta",
      base: PANTA_BASE,
      mode: mode,
      generatedAt: now,
      note:
        "PANTA_API_KEY is not set on this deployment, so the live markets feed is disabled. " +
        "Set it to a pk_test_ key from Panta to enable this endpoint.",
    };
    if (mode === "market") {
      off.market = null;
      off.prices = null;
    } else if (mode === "positions") {
      off.wallet = q.wallet || null;
      off.counts = { positions: 0 };
      off.positions = [];
    } else {
      off.counts = { markets: 0 };
      off.nextCursor = null;
      off.markets = [];
    }
    return off;
  }

  var url;
  if (mode === "market") {
    if (!isAddress(q.market)) {
      throw Object.assign(new Error("market must be a base58 market address"), { status: 400 });
    }
    url = marketDetailUrl(q.market);
  } else if (mode === "positions") {
    if (!isAddress(q.wallet)) {
      throw Object.assign(new Error("wallet must be a base58 Solana address"), { status: 400 });
    }
    url = positionsUrl(q.wallet);
  } else {
    url = pantaUrl(q);
  }

  var payload = await pantaGet(url, deps);
  var disclaimer = typeof payload.disclaimer === "string" ? payload.disclaimer : null;

  if (mode === "market") {
    if (typeof payload.marketId !== "string") {
      // A 200 without a marketId is a broken read, not "no market".
      throw Object.assign(new Error("Panta API returned a malformed market"), { status: 502 });
    }
    return {
      ok: true,
      configured: true,
      sandbox: sandbox,
      source: "panta",
      attribution: "Powered by Panta",
      base: PANTA_BASE,
      mode: "market",
      generatedAt: now,
      disclaimer: disclaimer,
      market: normalizeMarket(payload),
      // The list route leaves these null; the detail route fills them from
      // on-chain state. Panta's docs use them to price a position.
      prices: {
        yes: payload.yesPrice == null ? null : payload.yesPrice,
        no: payload.noPrice == null ? null : payload.noPrice,
        primaryYes: payload.primaryYesPrice == null ? null : payload.primaryYesPrice,
        primaryNo: payload.primaryNoPrice == null ? null : payload.primaryNoPrice,
        secondaryYes: payload.secondaryYesPrice == null ? null : payload.secondaryYesPrice,
        secondaryNo: payload.secondaryNoPrice == null ? null : payload.secondaryNoPrice,
      },
    };
  }

  if (mode === "positions") {
    if (!Array.isArray(payload.positions)) {
      // Same rule as the list: an anomaly must not read as "this wallet holds
      // nothing", which is a claim about a user's money.
      throw Object.assign(new Error("Panta API returned a malformed position list"), { status: 502 });
    }
    return {
      ok: true,
      configured: true,
      sandbox: sandbox,
      source: "panta",
      attribution: "Powered by Panta",
      base: PANTA_BASE,
      mode: "positions",
      generatedAt: now,
      disclaimer: disclaimer,
      wallet: typeof payload.wallet === "string" ? payload.wallet : q.wallet,
      counts: { positions: payload.positions.length },
      positions: payload.positions.map(normalizePosition),
    };
  }

  if (!Array.isArray(payload.items)) {
    // A 200 without an items array is a broken read, not "no markets". Returning
    // an empty list would present a partner or network anomaly as data.
    throw Object.assign(new Error("Panta API returned a malformed market list"), { status: 502 });
  }
  var items = payload.items;

  return {
    ok: true,
    configured: true,
    sandbox: sandbox,
    source: "panta",
    attribution: "Powered by Panta",
    base: PANTA_BASE,
    mode: "list",
    generatedAt: now,
    disclaimer: disclaimer,
    counts: { markets: items.length },
    nextCursor: (payload && payload.nextCursor) || null,
    markets: items.map(normalizeMarket),
  };
}

/**
 * Vercel Node function entry point. CommonJS for the same reason `api/trust.js`
 * is: the root `package.json` has no `"type": "module"`.
 */
module.exports = async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed; use GET" }));
  }

  log.track("markets", req, res);

  // Best effort, per instance: see lib/rate-limit.js for what this does and does
  // not cover. The partner feed is the shared resource being protected here.
  if (throttle.limited(req)) {
    res.statusCode = 429;
    res.setHeader("retry-after", String(Math.ceil(throttle.WINDOW_MS / 1000)));
    return res.end(
      JSON.stringify({
        ok: false,
        error: "too many requests; markets are cached for " + CACHE_SECONDS + " seconds",
      })
    );
  }

  try {
    var payload = await buildResponse(req.query || {}, {
      fetchImpl: globalThis.fetch,
      now: Math.floor(Date.now() / 1000),
      apiKey: process.env.PANTA_API_KEY || "",
    });

    res.statusCode = 200;
    res.setHeader("x-equxi-configured", payload.configured ? "true" : "false");
    res.setHeader(
      "cache-control",
      "public, s-maxage=" + CACHE_SECONDS + ", stale-while-revalidate=" + STALE_SECONDS
    );
    return res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = error && error.status ? error.status : 502;
    return res.end(
      JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) })
    );
  }
};

// Exposed for the unit tests, which drive these directly.
module.exports.buildResponse = buildResponse;
module.exports.normalizeMarket = normalizeMarket;
module.exports.normalizePosition = normalizePosition;
module.exports.pantaUrl = pantaUrl;
module.exports.marketDetailUrl = marketDetailUrl;
module.exports.positionsUrl = positionsUrl;
module.exports.statusForCode = statusForCode;
