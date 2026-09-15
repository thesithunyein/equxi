/**
 * `GET /api/badge` — an embeddable SVG trust badge for one agent.
 *
 * A registry nobody can embed is a page nobody visits twice. This endpoint is
 * the distribution half of the Explorer: any README, dapp, or agent card can
 * show
 *
 *   [![Equxi trust](https://equxi.sithunyein.com/api/badge?agent=<pda>)](https://equxi.sithunyein.com/explorer.html?agent=<pda>)
 *
 * and it will keep telling the truth on its own, because every request re-reads
 * the chain. A badge is not a certificate; it is a live view.
 *
 * ## Honesty rules this file follows
 *
 * * **Unknown is not a pass.** An address with no agent account returns a grey
 *   `unknown` badge, not a green one, and `x-equxi-status: unknown`. It is
 *   deliberately a `200` rather than a `404`: a broken image in a README hides
 *   the fact, while a grey badge shows it.
 * * **Ungraded is not a pass.** An agent with no collateral at stake renders as
 *   grey `ungraded`, matching the Explorer.
 * * **Nothing from the chain is trusted as markup.** Agent names and slash
 *   reasons are attacker controlled, so every value is XML-escaped and stripped
 *   of control characters before it reaches the SVG.
 *
 * ## Query parameters
 *
 * | Param | Meaning |
 * |-------|---------|
 * | `agent=<pubkey>` | Required. The agent PDA to render |
 * | `cluster=devnet\|testnet\|mainnet-beta` | RPC cluster (default `devnet`) |
 * | `label=<text>` | Left-hand label (default `equxi`, max 24 chars) |
 * | `format=svg\|json` | `svg` (default) or the underlying numbers |
 *
 * No dependencies, for the same reason `api/trust.js` has none: `vercel.json`
 * disables the build step, so anything imported has to resolve unbuilt.
 */
"use strict";

var L = require("../lib/equxi-layout.js");
var trust = require("./trust.js");

/** Badge colours by grade. `ungraded`/`unknown` are grey on purpose. */
var GRADE_COLORS = {
  A: "#14f195",
  B: "#14f195",
  C: "#f0b429",
  D: "#ff5454",
  F: "#ff5454",
  ungraded: "#6b6b6b",
  unknown: "#6b6b6b",
};

var LABEL_COLOR = "#2b2b2b";
var MAX_LABEL = 24;

/** Cached briefly: a badge in a README is fetched often and changes rarely. */
var CACHE_SECONDS = 60;

/** Strip control characters, which are illegal in XML 1.0 and can break parsers. */
function printable(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "");
}

/** Escape for XML text and attribute context. */
function xml(value) {
  return printable(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Approximate the width of a string at 11px in the fallback sans font.
 * An SVG cannot measure text, and a badge that clips its own value is worse than
 * one that is a few pixels wide, so this errs on the generous side.
 */
function textWidth(text) {
  var width = 0;
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    // Wide glyphs (W, M, @) and anything non-ASCII get extra room.
    width += c > 0x2e80 ? 12 : c === 0x57 || c === 0x4d || c === 0x40 ? 8.4 : 6.35;
  }
  return width;
}

/**
 * Render a two-part badge. Pure and dependency-free so the unit tests can assert
 * the SVG text without a network or a browser.
 */
function renderBadge(opts) {
  var label = printable(opts.label || "equxi").slice(0, MAX_LABEL) || "equxi";
  var value = printable(opts.value || "");
  var color = GRADE_COLORS[opts.grade] || GRADE_COLORS.unknown;

  var pad = 5;
  var labelW = Math.round(textWidth(label) + pad * 2);
  var valueW = Math.round(textWidth(value) + pad * 2 + 4);
  var totalW = labelW + valueW;
  var h = 20;

  var labelCx = Math.round(labelW / 2);
  var valueCx = Math.round(labelW + valueW / 2);

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    totalW +
    '" height="' +
    h +
    '" viewBox="0 0 ' +
    totalW +
    " " +
    h +
    '" role="img" aria-label="' +
    xml(label + ": " + value) +
    '">' +
    "<title>" +
    xml(label + ": " + value) +
    "</title>" +
    // Rounded rect for the whole badge, flat colour for the value half. Drawn as
    // two rects so neither half needs a clip path.
    '<rect width="' +
    totalW +
    '" height="' +
    h +
    '" rx="4" fill="' +
    color +
    '"/>' +
    '<rect width="' +
    labelW +
    '" height="' +
    h +
    '" rx="4" fill="' +
    LABEL_COLOR +
    '"/>' +
    '<rect x="' +
    (labelW - 4) +
    '" width="4" height="' +
    h +
    '" fill="' +
    LABEL_COLOR +
    '"/>' +
    '<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">' +
    '<text x="' +
    labelCx +
    '" y="14" text-anchor="middle">' +
    xml(label) +
    "</text>" +
    '<text x="' +
    valueCx +
    '" y="14" text-anchor="middle" font-weight="bold">' +
    xml(value) +
    "</text>" +
    "</g></svg>"
  );
}

/**
 * Build the numbers behind a badge from the shared read layer.
 *
 * Reuses `buildResponse` rather than issuing its own RPC calls, so the badge and
 * the Explorer can never disagree about what an agent's score is.
 */
async function buildBadge(query, deps) {
  if (!query.agent) {
    throw Object.assign(new Error("agent query parameter is required"), { status: 400 });
  }
  if (!L.isPubkey(query.agent)) {
    throw Object.assign(new Error("agent must be a base58-encoded 32-byte pubkey"), {
      status: 400,
    });
  }

  var payload = await trust.buildResponse(
    { agent: query.agent, cluster: query.cluster, rpc: query.rpc },
    deps
  );

  var agent = payload.agents[0];
  if (!agent) {
    return {
      status: "unknown",
      label: query.label || "equxi",
      value: "not found",
      grade: "unknown",
      reason: "No agent account exists at this address on " + payload.cluster + ".",
      generatedAt: payload.generatedAt,
      cluster: payload.cluster,
      agent: null,
    };
  }

  var profile = agent.profile;
  var value =
    profile.grade === "ungraded" ? "ungraded" : profile.grade + " " + profile.score;

  return {
    status: "graded",
    label: query.label || "equxi",
    value: value,
    grade: profile.grade,
    reason:
      profile.grade === "ungraded"
        ? "No collateral at stake, so this agent is not graded."
        : null,
    generatedAt: payload.generatedAt,
    cluster: payload.cluster,
    agent: {
      address: agent.address,
      name: agent.name,
      grade: profile.grade,
      score: profile.score,
      onChainTrustScore: profile.onChainTrustScore,
      bondSol: profile.bond ? profile.bond.amountSol : 0,
      slashCount: profile.stats.slashCount,
      openSlashes: profile.stats.openSlashes,
      breakdown: profile.breakdown,
      explorer: "https://equxi.sithunyein.com/explorer.html?agent=" + agent.address,
    },
  };
}

/** Vercel Node function entry point, matching `api/trust.js`. */
module.exports = async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "method not allowed; use GET" }));
  }

  var query = req.query || {};
  var format = query.format === "json" ? "json" : "svg";

  var badge;
  try {
    badge = await buildBadge(query, {
      fetchImpl: globalThis.fetch,
      now: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    var status = error && error.status ? error.status : 502;
    res.statusCode = status;
    res.setHeader("cache-control", "no-store");
    if (format === "json") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(
        JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) })
      );
    }
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    return res.end(renderBadge({ label: query.label || "equxi", value: "error", grade: "unknown" }));
  }

  res.statusCode = 200;
  res.setHeader("cache-control", "public, s-maxage=" + CACHE_SECONDS);
  // Machine-readable outcome: a consumer never has to parse the SVG to learn
  // whether the address was actually known.
  res.setHeader("x-equxi-status", badge.status);
  res.setHeader("x-equxi-grade", badge.grade);
  res.setHeader("x-equxi-score", String(badge.agent ? badge.agent.score : ""));

  if (format === "json") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(badge));
  }

  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  return res.end(renderBadge({ label: badge.label, value: badge.value, grade: badge.grade }));
};

// Exposed for the unit tests, which drive these directly.
module.exports.renderBadge = renderBadge;
module.exports.buildBadge = buildBadge;
module.exports.textWidth = textWidth;
