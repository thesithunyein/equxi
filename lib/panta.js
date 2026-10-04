/**
 * lib/panta.js — dependency-free client for Panta's market-creation and trading flows.
 *
 * `api/markets.js` covers discovery. This library covers the rest of Panta's
 * capability list, so Equxi can do the thing the sidetrack actually judges:
 * create a market whose resolution source is an on-chain Equxi slash record,
 * trade it, and report the trade back for attribution.
 *
 * The flows are the ones Panta documents (checked against docs.panta.market on
 * 2026-10-05). Every amount and route follows their rules exactly:
 *
 *   create : POST /markets/create/quote/  -> {"createId", "paymentUsdc", …}
 *            POST /markets/create/build/  -> {"transaction": base64 VersionedTransaction}
 *            (decode, sign with the creator wallet, broadcast, then)
 *            POST /markets/register/      -> {"marketId", "status": "registered"}
 *
 *   buy    : POST /primaryorderquote/     -> {"quoteId", "shares", "avgPrice", …}
 *            POST /primaryorderbuild/     -> {"orderId", "instructions": […], "recentBlockhash"}
 *            (compile, sign, broadcast, then)
 *            POST /primaryordersubmit/    -> {"status": "submitted"}
 *            POST /trades/                -> trade attribution for visibility
 *
 * No keys are held or signed here: this module only carries HTTP. The wallet
 * and the signer live in the CLI (`panta-agent-market.js`), which is the same
 * custody model Panta mandates.
 *
 * `fetchImpl` is injected, so `tests/unit/panta.test.ts` drives every path with
 * no network and asserts the exact routes, bodies and headers Panta expects.
 */
"use strict";

var PANTA_BASE = "https://live-api.panta.market/api/v1";

/** Categories Panta accepts for market creation (docs: markets/create/quote). */
var CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"];

/** Standard markets must start at least this far in the future (docs: ~3600s). */
var MIN_START_DELAY_SECONDS = 3600;

/** Upstream calls get a hard ceiling so a hung partner cannot hang a script. */
var UPSTREAM_TIMEOUT_MS = 15000;

/** Build the error every function throws on failure, keeping Panta's code. */
function PantaError(code, message, status, fields) {
  var error = new Error("Panta API error: " + code + (message ? " — " + message : ""));
  error.name = "PantaError";
  error.code = code;
  error.status = status;
  if (fields) error.fields = fields;
  return error;
}

/** One HTTP call. Failures surface Panta's `{code, message}` shape unchanged. */
async function request(fetchImpl, apiKey, method, path, body) {
  var init = {
    method: method,
    headers: { "X-Api-Key": apiKey, accept: "application/json" },
  };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  }

  var response;
  try {
    response = await fetchImpl(PANTA_BASE + path, init);
  } catch (error) {
    throw PantaError("NETWORK", (error && error.message) || String(error), 0);
  }

  var payload = null;
  try {
    payload = await response.json();
  } catch (ignored) {
    payload = null;
  }

  if (!response.ok) {
    throw PantaError(
      (payload && payload.code) || "HTTP_" + response.status,
      payload && payload.message,
      response.status,
      payload && payload.fields
    );
  }
  return payload;
}

/* ── create ───────────────────────────────────────────────────────────── */

function quoteMarketCreate(fetchImpl, apiKey, params) {
  return request(fetchImpl, apiKey, "POST", "/markets/create/quote/", params);
}

function buildMarketCreate(fetchImpl, apiKey, body) {
  return request(fetchImpl, apiKey, "POST", "/markets/create/build/", body);
}

function registerMarket(fetchImpl, apiKey, body) {
  return request(fetchImpl, apiKey, "POST", "/markets/register/", body);
}

/* ── primary buy ──────────────────────────────────────────────────────── */

function quotePrimaryBuy(fetchImpl, apiKey, body) {
  return request(fetchImpl, apiKey, "POST", "/primaryorderquote/", body);
}

function buildPrimaryBuy(fetchImpl, apiKey, body) {
  return request(fetchImpl, apiKey, "POST", "/primaryorderbuild/", body);
}

function submitPrimaryBuy(fetchImpl, apiKey, body) {
  return request(fetchImpl, apiKey, "POST", "/primaryordersubmit/", body);
}

/** Attribution for trade volume. Idempotent per signature, per docs. */
function reportTrade(fetchImpl, apiKey, body) {
  return request(fetchImpl, apiKey, "POST", "/trades/", body);
}

/* ── the Equxi question ───────────────────────────────────────────────── */

var DEFAULT_PROGRAM_ID = "D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc";
var DEFAULT_SITE = "https://equxi.sithunyein.com";

/**
 * Build the market parameters for one agent-risk question:
 *
 *   "Will Equxi agent <name> (<address>) be slashed before <resolveBy>?"
 *
 * Resolution is deliberately mechanical and public: YES iff the Equxi program
 * holds a slash record for that agent executed before the end time. The
 * sources point at the same read API anyone can curl, so a resolver does not
 * need trust in us — only the chain.
 *
 * Pure and validated here so the CLI (and its tests) cannot ship a market whose
 * times violate Panta's rules.
 */
function agentMarketPlan(input) {
  var now = input.now;
  var resolveBy = input.resolveBy; // unix seconds
  if (!now || !resolveBy) throw new Error("agentMarketPlan needs now and resolveBy (unix seconds)");
  if (!(resolveBy > now + MIN_START_DELAY_SECONDS + 900)) {
    throw new Error(
      "resolveBy must be at least " + (MIN_START_DELAY_SECONDS + 900) + "s after now — " +
        "Panta enforces a ~" + MIN_START_DELAY_SECONDS + "s minimum start delay on standard markets"
    );
  }

  var address = input.agentAddress;
  var name = input.agentName || "unnamed";
  var programId = input.programId || DEFAULT_PROGRAM_ID;
  var site = input.site || DEFAULT_SITE;
  var category = input.category || "crypto";
  if (CATEGORIES.indexOf(category) === -1) {
    throw new Error("category must be one of: " + CATEGORIES.join(", "));
  }

  var question = 'Will Equxi agent "' + name + '" (' + address + ") be slashed before " + input.resolveByLabel + "?";
  if (question.length > 512) throw new Error("question exceeds Panta's 512-char limit");

  var apiUrl = site + "/api/trust?agent=" + address;
  var explorer = "https://explorer.solana.com/address/" + programId + "?cluster=devnet";

  return {
    question: question,
    title: "Slash risk: " + name,
    description:
      "Prices the consequence side of an AI agent: " +
      name +
      " runs with " +
      "slashable collateral bonded in the Equxi program. YES resolves if that collateral is ever seized " +
      "for a recorded violation before the end time.",
    resolutionRule:
      "Resolves YES if the Equxi program (" +
      programId +
      ") holds a SlashRecord for agent " +
      address +
      " with executed_at strictly before the end time (unix " +
      input.resolveByLabel +
      "), whether or not it has been compensated. Resolves NO otherwise. " +
      "Slash records are public and verifiable: " +
      apiUrl,
    sourcesOfTruth: [apiUrl, explorer],
    category: category,
    startTime: now + MIN_START_DELAY_SECONDS + 300,
    endTime: resolveBy,
    resolutionTime: resolveBy + 86400,
    marketType: "standard",
    region: input.region || "Global",
  };
}

module.exports = {
  PANTA_BASE: PANTA_BASE,
  CATEGORIES: CATEGORIES,
  MIN_START_DELAY_SECONDS: MIN_START_DELAY_SECONDS,
  PantaError: PantaError,
  quoteMarketCreate: quoteMarketCreate,
  buildMarketCreate: buildMarketCreate,
  registerMarket: registerMarket,
  quotePrimaryBuy: quotePrimaryBuy,
  buildPrimaryBuy: buildPrimaryBuy,
  submitPrimaryBuy: submitPrimaryBuy,
  reportTrade: reportTrade,
  agentMarketPlan: agentMarketPlan,
};
