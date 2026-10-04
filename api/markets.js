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
 * * **Panta errors keep their meaning.** `RATE_LIMITED` becomes a 429 so
 *   callers back off; `INVALID_MARKET_PARAMS` becomes a 400; a rejected key
 *   (`UNAUTHORIZED`) becomes a 502, because that is this deployment's config
 *   fault, not the caller's.
 *
 * ## Query parameters (forwarded to Panta)
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

/** Panta's live API. Its router requires the trailing slash on every route. */
var PANTA_BASE = "https://live-api.panta.market/api/v1";

/** Only these query params are forwarded; Panta validates their values. */
var PASS_THROUGH = ["category", "status", "createdBy", "cursor", "limit"];

var MIN_LIMIT = 1;
var MAX_LIMIT = 50; // Panta's documented page-size ceiling.

/** Public reads may be cached; markets move, but the partner should not be hammered. */
var CACHE_SECONDS = 30;

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

/** Map Panta's error codes onto the HTTP status this API should answer with. */
function statusForCode(code) {
  if (code === "INVALID_MARKET_PARAMS") return 400;
  if (code === "RATE_LIMITED") return 429;
  return 502; // UNAUTHORIZED and anything unrecognised are upstream faults here.
}

/**
 * Build the JSON payload. Separated from the HTTP handler so the tests can
 * assert on it directly. `deps` = `{ fetchImpl, now, apiKey }`.
 */
async function buildResponse(query, deps) {
  var now = deps.now;

  if (!deps.apiKey) {
    return {
      ok: true,
      configured: false,
      source: "panta",
      // Required by Panta's Terms of Use wherever Panta-powered functionality
      // appears; the Explorer card will render it once the card lands.
      attribution: "Powered by Panta",
      base: PANTA_BASE,
      generatedAt: now,
      note:
        "PANTA_API_KEY is not set on this deployment, so the live markets feed is disabled. " +
        "Set it to a pk_test_ key from Panta to enable this endpoint.",
      counts: { markets: 0 },
      nextCursor: null,
      markets: [],
    };
  }

  var url = pantaUrl(query || {});

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

  if (!response.ok) {
    var errorBody = null;
    try {
      errorBody = await response.json();
    } catch (ignored) {
      errorBody = null;
    }
    var code =
      (errorBody && (errorBody.error || errorBody.code)) || "HTTP " + response.status;
    throw Object.assign(new Error("Panta API error: " + code), { status: statusForCode(String(code)) });
  }

  var payload = await response.json();
  if (!payload || !Array.isArray(payload.items)) {
    // A 200 without an items array is a broken read, not "no markets". Returning
    // an empty list would present a partner or network anomaly as data.
    throw Object.assign(new Error("Panta API returned a malformed market list"), { status: 502 });
  }
  var items = payload.items;

  return {
    ok: true,
    configured: true,
    source: "panta",
    attribution: "Powered by Panta",
    base: PANTA_BASE,
    generatedAt: now,
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

  try {
    var payload = await buildResponse(req.query || {}, {
      fetchImpl: globalThis.fetch,
      now: Math.floor(Date.now() / 1000),
      apiKey: process.env.PANTA_API_KEY || "",
    });

    res.statusCode = 200;
    res.setHeader("x-equxi-configured", payload.configured ? "true" : "false");
    res.setHeader("cache-control", "public, s-maxage=" + CACHE_SECONDS);
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
module.exports.pantaUrl = pantaUrl;
