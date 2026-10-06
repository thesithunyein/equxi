/**
 * `GET /api/health` — is the read path actually working?
 *
 * Every page on this site reads its numbers from one upstream: the Solana RPC
 * named by `EQUXI_RPC`, or the public cluster endpoint behind it. When that
 * upstream is slow or rate-limited the pages still render — they just render a
 * stale or empty state, and nothing anywhere says so. This endpoint is that
 * "so": a machine-readable answer to *can this deployment read the chain right
 * now?*
 *
 * Deliberately cheap — a single `getSlot` — so an uptime check can poll it
 * without adding meaningful load, and deliberately public: a product whose
 * claim is verifiability should be willing to be asked how it is doing.
 *
 * | Status | Meaning |
 * |--------|---------|
 * | `200` | The RPC answered. Bodies carry the slot and the round-trip time. |
 * | `503` | The RPC did not answer, with the reason. |
 *
 * The upstream is reported as its **host only**: a paid provider's URL can
 * carry an API key in its path, and health output gets pasted into issues.
 *
 * It also states which Panta feed this deployment is wired to. A `pk_test_` key
 * answers with sandbox fixtures, which is a fact a reader of `/api/markets`
 * should not have to discover from a disclaimer field — so the health payload
 * names it. This is informational and never changes the status code: an
 * unconfigured or sandbox feed is a deliberate configuration, not an outage.
 */
"use strict";

var trust = require("./trust.js");
var log = require("../lib/log.js");

/** A health check that can hang is not a health check. */
var TIMEOUT_MS = 5000;

/** Host only, so no credential ever leaves in a response body. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return "unparseable";
  }
}

/**
 * Which Panta feed this deployment talks to. `sandbox` is a `pk_test_` key,
 * whose answers are fixtures; `live` is a `pk_live_` key. Never a secret — only
 * the mode is reported, never the key.
 */
function pantaFeed() {
  var key = process.env.PANTA_API_KEY || "";
  if (!key) return { configured: false, sandbox: null };
  return { configured: true, sandbox: key.indexOf("pk_test_") === 0 };
}

/**
 * Vercel Node function entry point. CommonJS for the same reason as the other
 * handlers: the root `package.json` has no `"type": "module"`.
 */
module.exports = async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed; use GET" }));
  }

  // A health check is a request like any other; logging it is how an operator
  // notices a poller that has started failing rather than merely slow.
  log.track("health", req, res);

  var cluster = (req.query && req.query.cluster) || process.env.EQUXI_CLUSTER || "devnet";
  var rpcUrl = process.env.EQUXI_RPC || trust.CLUSTER_RPC[cluster];

  if (!rpcUrl) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: "unknown cluster: " + cluster }));
  }

  var started = Date.now();
  var payload = {
    ok: true,
    service: "equxi",
    cluster: cluster,
    program: trust.PROGRAM_ID,
    upstream: { host: hostOf(rpcUrl) },
    feeds: { panta: pantaFeed() },
    generatedAt: Math.floor(Date.now() / 1000),
  };

  try {
    var call = trust.createRpc(rpcUrl, globalThis.fetch, { timeoutMs: TIMEOUT_MS });
    var slot = await call("getSlot", []);
    payload.upstream.reachable = true;
    payload.upstream.slot = slot;
    payload.upstream.latencyMs = Date.now() - started;
    res.statusCode = 200;
  } catch (error) {
    payload.ok = false;
    payload.upstream.reachable = false;
    payload.upstream.latencyMs = Date.now() - started;
    payload.upstream.error = String((error && error.message) || error).slice(0, 160);
    res.statusCode = 503;
  }

  return res.end(JSON.stringify(payload));
};
