/**
 * `GET /api/trust` — the public read API.
 *
 * This is the programmatic half of Equxi's accountability claim. A counterparty
 * (or a judge) should not have to read Rust to answer one question: *does this
 * agent have collateral at risk, and has it ever been slashed?* This endpoint
 * answers it as JSON.
 *
 * ## Design constraints, and why the code looks like this
 *
 * * **No dependencies.** `vercel.json` sets `"buildCommand": null`, so nothing
 *   bundles this. It is the Node standard library plus `lib/equxi-layout.js`,
 *   which also keeps cold starts flat.
 * * **No PDA derivation.** Finding a bond for an agent normally means deriving
 *   the bond PDA, which needs `sha256` plus an Ed25519 on-curve check — real
 *   cryptography that should not be reimplemented by hand here. Every lookup
 *   instead uses `memcmp` filters on stored fields, or `getAccountInfo` on an
 *   address the caller already has.
 * * **`fetch` is injected.** `tests/unit/api.test.ts` drives the handler with a
 *   stub, so filters, decoding, joining, and every error path are exercised with
 *   no network and no validator.
 *
 * ## Query parameters
 *
 * | Param | Meaning |
 * |-------|---------|
 * | *(none)* | Whole registry: every agent, with bond + slash history joined |
 * | `agent=<pubkey>` | One agent, by its agent PDA address |
 * | `owner=<pubkey>` | Every agent owned by a wallet |
 * | `cluster=devnet\|testnet\|mainnet-beta` | RPC cluster (default `devnet`) |
 * | `rpc=<url>` | Explicit RPC endpoint. Development only: a deployment refuses it unless `EQUXI_ALLOW_RPC=1` |
 *
 * A query that names one address (`agent=` or `owner=`) and finds nothing is
 * still a `200`: an owner with no agents is an answer, not an error.
 * `?agent=<pubkey>` is the one exception. A named agent that holds no account
 * is a `404` with `code: "AGENT_NOT_FOUND"`, because a caller asking about a
 * single address has to be able to tell "not found" from "found, with nothing
 * at stake" — and only the first is a missing resource. A named owner is never
 * a 404: the address exists, it just holds no agents.
 *
 * A deployment can set `EQUXI_RPC` to make every read default to a dedicated
 * endpoint (for example RPC Fast's Focus plan); an explicit `?rpc=` still wins.
 */
"use strict";

var L = require("../lib/equxi-layout.js");
var throttle = require("../lib/rate-limit.js");
var log = require("../lib/log.js");

var CLUSTER_RPC = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

/** Response cache. Reads are public and change slowly. */
var CACHE_SECONDS = 30;

/**
 * How long the CDN may keep serving a cached copy while it refreshes the next
 * one in the background. Without this, every expiry sent a fresh reader to a
 * whole-program scan; with it, only the first request after expiry does that.
 */
var STALE_SECONDS = 300;

/** Upstream reads get a hard ceiling, so a hung RPC cannot hang the API. */
var UPSTREAM_TIMEOUT_MS = 8000;

/** One retry per endpoint before the next endpoint (or failure) is tried. */
var RETRY_DELAY_MS = 300;

/** Above this many agents, a targeted query falls back to whole-program scans. */
var MAX_TARGETED_AGENTS = 8;

var DECODERS = {
  Agent: L.decodeAgent,
  Vault: L.decodeVault,
  Bond: L.decodeBond,
  Constraint: L.decodeConstraint,
  SlashRecord: L.decodeSlashRecord,
};

/* ── JSON-RPC ─────────────────────────────────────────────────────────── */

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Is this upstream failure worth one more try? The public cluster endpoint
 * answers 429 when it is busy, and 5xx when it is unwell; before this, a single
 * 429 on a busy afternoon reached the reader as a dead landing page.
 */
function isTransient(status) {
  return status === 429 || status >= 500;
}

/**
 * Minimal JSON-RPC caller. Solana's RPC is a `POST` of one JSON object.
 * `fetchImpl` is a parameter rather than the global so tests can drive it.
 *
 * Every call is bounded by a timeout and a transient failure is retried once,
 * because this single upstream is what every page reads its numbers from: it
 * should be able to degrade to a slow read rather than to an error page.
 */
function createRpc(rpcUrl, fetchImpl, options) {
  var opts = options || {};
  var timeoutMs = opts.timeoutMs || UPSTREAM_TIMEOUT_MS;

  return async function call(method, params, attempt) {
    var tried = attempt || 0;
    var init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
    };

    // Without a signal, a stalled socket holds the function open until the
    // platform kills it and the reader gets a 502 with no explanation.
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      init.signal = AbortSignal.timeout(timeoutMs);
    }

    var response;
    try {
      response = await fetchImpl(rpcUrl, init);
    } catch (error) {
      if (tried === 0) {
        await sleep(RETRY_DELAY_MS);
        return call(method, params, 1);
      }
      throw error;
    }

    if (!response.ok) {
      if (isTransient(response.status) && tried === 0) {
        await sleep(RETRY_DELAY_MS);
        return call(method, params, 1);
      }
      throw new Error("RPC " + method + " failed with HTTP " + response.status);
    }

    var payload = await response.json();
    if (payload.error) {
      throw new Error("RPC " + method + ": " + (payload.error.message || "unknown error"));
    }
    return payload.result;
  };
}

/**
 * Try the primary endpoint, then each fallback, before giving up. These reads
 * are idempotent, so moving to another endpoint mid-request costs time and
 * nothing else. With no fallbacks configured this is the primary alone, which
 * is the honest default: the public endpoint is the only keyless option, and
 * `EQUXI_RPC_FALLBACKS` is where a paid provider's second host goes.
 */
function createRpcWithFallback(primary, fallbacks, fetchImpl, options) {
  var urls = [primary].concat(fallbacks || []);

  return async function call(method, params) {
    var lastError;
    for (var i = 0; i < urls.length; i++) {
      try {
        return await createRpc(urls[i], fetchImpl, options)(method, params);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
}

/**
 * Fetch every account of one type, decoded, optionally narrowed by filters.
 *
 * Solana caps `getProgramAccounts` at ~100 KB of returned data per call, which
 * is roughly 850 of these accounts. Exceeding it makes the RPC return an error
 * rather than truncating silently, and the caller surfaces that as a 502.
 * Paging is listed as an open problem in `SPEC.md` rather than pretended away.
 */
async function fetchAccounts(call, name, extraFilters) {
  var filters = [L.discriminatorFilter(name)];
  if (extraFilters) filters = filters.concat(extraFilters);

  var accounts = await call("getProgramAccounts", [
    L.PROGRAM_ID,
    { encoding: "base64", filters: filters },
  ]);

  return (accounts || []).map(function (entry) {
    return {
      address: entry.pubkey,
      data: DECODERS[name](Buffer.from(entry.account.data[0], "base64")),
    };
  });
}

/** Read one account by address and decode it, verifying its discriminator. */
async function fetchOne(call, address, name) {
  var info = await call("getAccountInfo", [address, { encoding: "base64" }]);
  if (!info || !info.value) return null;

  var data = Buffer.from(info.value.data[0], "base64");
  var disc = L.ACCOUNT_DISCRIMINATORS[name];
  for (var i = 0; i < 8; i++) {
    if (data[i] !== disc[i]) return null; // Right address, wrong account type.
  }

  return { address: address, data: DECODERS[name](data) };
}

/* ── assembly ─────────────────────────────────────────────────────────── */

/** Join the flat account lists into one profile per agent. */
function assembleRegistry(agents, bonds, slashes, constraints, now) {
  var bondsByAgent = {};
  bonds.forEach(function (b) {
    bondsByAgent[b.data.agent] = b.data;
  });

  var slashesByAgent = {};
  slashes.forEach(function (s) {
    (slashesByAgent[s.data.agent] = slashesByAgent[s.data.agent] || []).push(s.data);
  });

  var constraintsByAgent = {};
  constraints.forEach(function (c) {
    (constraintsByAgent[c.data.agent] = constraintsByAgent[c.data.agent] || []).push(c.data);
  });

  return agents.map(function (a) {
    return {
      address: a.address,
      name: a.data.name,
      owner: a.data.owner,
      agentType: a.data.agentType,
      status: a.data.status,
      // Which on-chain layout the Agent account was written with. v0.1 accounts
      // have no constraint counter, which is reported as 0 rather than guessed.
      layout: a.data.layout,
      constraintCount: a.data.constraintCount,
      createdAt: a.data.createdAt,
      constraints: (constraintsByAgent[a.address] || []).map(function (c) {
        return { type: c.constraintType, isEnforced: c.isEnforced, params: c.params };
      }),
      profile: L.buildTrustProfile({
        agent: a.data,
        bond: bondsByAgent[a.address] || null,
        slashes: slashesByAgent[a.address] || [],
        now: now,
      }),
    };
  });
}

/* ── payload ──────────────────────────────────────────────────────────── */

/**
 * Build the JSON payload for a request. Separated from the HTTP handler so the
 * tests can assert on the payload without constructing a `res` object.
 */
async function buildResponse(query, deps) {
  var now = deps.now;

  var cluster = query.cluster || "devnet";
  if (!CLUSTER_RPC[cluster]) {
    throw Object.assign(new Error("unknown cluster: " + cluster), { status: 400 });
  }

  // An explicit `?rpc=` is a development affordance. A deployment refuses it
  // unless EQUXI_ALLOW_RPC=1, because otherwise this endpoint is an open
  // request proxy — and, worse for a product whose claim is verifiability,
  // anyone could point it at a node they control and then cite an equxi URL as
  // evidence for accounts that node invented.
  var deployed = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  if (query.rpc && deployed && process.env.EQUXI_ALLOW_RPC !== "1") {
    throw Object.assign(new Error("rpc override is disabled on this deployment"), {
      status: 400,
    });
  }

  // Precedence: explicit ?rpc= (development), then the deployment default from
  // EQUXI_RPC (dedicated infra), then the public cluster endpoint.
  var rpcUrl = query.rpc || process.env.EQUXI_RPC || CLUSTER_RPC[cluster];

  var fallbacks = (process.env.EQUXI_RPC_FALLBACKS || "")
    .split(",")
    .map(function (url) {
      return url.trim();
    })
    .filter(function (url) {
      return url && url !== rpcUrl;
    });

  for (var i = 0; i < ["agent", "owner"].length; i++) {
    var key = ["agent", "owner"][i];
    if (query[key] && !L.isPubkey(query[key])) {
      throw Object.assign(new Error(key + " must be a base58-encoded 32-byte pubkey"), {
        status: 400,
      });
    }
  }

  var call = createRpcWithFallback(rpcUrl, fallbacks, deps.fetchImpl);

  /* --- which agents? --- */
  var agents;
  if (query.agent) {
    // One cheap point read instead of scanning every agent to find one address.
    var found = await fetchOne(call, query.agent, "Agent");
    agents = found ? [found] : [];
  } else if (query.owner) {
    agents = await fetchAccounts(call, "Agent", [L.pubkeyFilter(query.owner, L.OFFSETS.Agent.owner)]);
  } else {
    agents = await fetchAccounts(call, "Agent", null);
  }

  /* --- their bonds, slashes and constraints --- */
  var bonds = [];
  var slashes = [];
  var constraints = [];

  if (agents.length > 0 && agents.length <= MAX_TARGETED_AGENTS && (query.agent || query.owner)) {
    // Targeted: one small filtered scan per agent per account type.
    for (var a = 0; a < agents.length; a++) {
      var agentAddress = agents[a].address;
      var perAgent = await Promise.all([
        fetchAccounts(call, "Bond", [L.pubkeyFilter(agentAddress, L.OFFSETS.Bond.agent)]),
        fetchAccounts(call, "SlashRecord", [
          L.pubkeyFilter(agentAddress, L.OFFSETS.SlashRecord.agent),
        ]),
        fetchAccounts(call, "Constraint", [
          L.pubkeyFilter(agentAddress, L.OFFSETS.Constraint.agent),
        ]),
      ]);
      bonds = bonds.concat(perAgent[0]);
      slashes = slashes.concat(perAgent[1]);
      constraints = constraints.concat(perAgent[2]);
    }
  } else if (agents.length > 0) {
    // Registry view: one scan per type, then join in memory.
    bonds = await fetchAccounts(call, "Bond", null);
    slashes = await fetchAccounts(call, "SlashRecord", null);
    constraints = await fetchAccounts(call, "Constraint", null);
  }

  /* --- escrow --- */
  var vaults = await fetchAccounts(call, "Vault", null);
  var vault = vaults.length > 0 ? vaults[0].data : null;

  var profiles = assembleRegistry(agents, bonds, slashes, constraints, now);

  var totals = profiles.reduce(
    function (acc, p) {
      acc.slashes += p.profile.stats.slashCount;
      acc.openSlashes += p.profile.stats.openSlashes;
      acc.bondedLamports += p.profile.bond ? BigInt(p.profile.bond.amountLamports) : 0n;
      return acc;
    },
    { slashes: 0, openSlashes: 0, bondedLamports: 0n }
  );

  /* --- reconciliation ------------------------------------------------------
   * Slash records are claims; the vault is custody. The records should sum to
   * what the vault reports it has taken in, and on a deployment that predates
   * escrow custody they do not: records written before v0.2 moved no lamports.
   * Per-record funding is not stored on chain, so the difference cannot be
   * attributed to a specific record — which is exactly why both numbers are
   * published side by side instead of one total that quietly omits the other.
   */
  var recordsSlashedLamports = slashes.reduce(function (acc, s) {
    return acc + BigInt(s.data.amountLamports);
  }, 0n);
  var recordsCompensatedLamports = slashes.reduce(function (acc, s) {
    return acc + (s.data.compensated ? BigInt(s.data.amountLamports) : 0n);
  }, 0n);
  var vaultSlashedLamports = vault ? BigInt(vault.totalSlashedLamports) : 0n;
  var vaultCompensatedLamports = vault ? BigInt(vault.totalCompensatedLamports) : 0n;

  /** Positive: records claim more than escrow has ever received. */
  var unescrowedLamports = recordsSlashedLamports - vaultSlashedLamports;

  var reconciliation = {
    recordsSlashedLamports: recordsSlashedLamports.toString(),
    recordsSlashedSol: Number(recordsSlashedLamports) / L.LAMPORTS_PER_SOL,
    recordsCompensatedLamports: recordsCompensatedLamports.toString(),
    vaultTotalSlashedLamports: vaultSlashedLamports.toString(),
    vaultTotalCompensatedLamports: vaultCompensatedLamports.toString(),
    unescrowedLamports: unescrowedLamports.toString(),
    unescrowedSol: Number(unescrowedLamports) / L.LAMPORTS_PER_SOL,
    balanced: unescrowedLamports === 0n,
  };

  /* --- program-level notes -------------------------------------------------
   * A deployment that predates v0.2 has no escrow vault and 116-byte Agent
   * accounts. Saying so up front is the difference between a reader knowing the
   * numbers are partial and assuming they are complete.
   */
  var programWarnings = [];
  var legacyAgents = profiles.filter(function (p) {
    return p.layout === "v1";
  });
  if (legacyAgents.length > 0) {
    programWarnings.push(
      legacyAgents.length +
        " agent(s) use the v0.1 account layout (116 bytes): constraint counts are unavailable, " +
        "and this deployment predates the v0.2 escrow vault."
    );
  }
  if (vault === null) {
    programWarnings.push(
      "No Vault account exists on this deployment, so slashed collateral is not yet held in program-owned escrow."
    );
  }
  if (unescrowedLamports > 0n) {
    programWarnings.push(
      "Slash records total " +
        reconciliation.recordsSlashedSol +
        " SOL but the escrow vault reports taking in " +
        Number(vaultSlashedLamports) / L.LAMPORTS_PER_SOL +
        " SOL. The " +
        reconciliation.unescrowedSol +
        " SOL difference is recorded-but-never-deposited collateral: those records predate escrow custody, so no " +
        "lamports entered the vault for them and they cannot be paid while escrow holds less than they claim."
    );
  }

  return {
    ok: true,
    cluster: cluster,
    program: L.PROGRAM_ID,
    generatedAt: now,
    warnings: programWarnings,
    counts: {
      agents: profiles.length,
      bonds: bonds.length,
      slashes: slashes.length,
      constraints: constraints.length,
    },
    totals: {
      slashCount: totals.slashes,
      openSlashes: totals.openSlashes,
      bondedLamports: totals.bondedLamports.toString(),
      bondedSol: Number(totals.bondedLamports) / L.LAMPORTS_PER_SOL,
    },
    vault: vault,
    reconciliation: reconciliation,
    agents: profiles,
  };
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

/**
 * Vercel Node function entry point.
 *
 * Exported on `module.exports` rather than as `export default` because the root
 * `package.json` has no `"type": "module"`, so `.js` here is CommonJS.
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

  // One line per real request, with the status and the latency. Attached here so
  // it covers the throttle refusal and the error paths too, not just the reads.
  log.track("trust", req, res);

  // Best effort, per instance: see lib/rate-limit.js for what this does and
  // does not cover. The CDN cache is the real shield for repeat readers.
  if (throttle.limited(req)) {
    res.statusCode = 429;
    res.setHeader("retry-after", String(Math.ceil(throttle.WINDOW_MS / 1000)));
    return res.end(
      JSON.stringify({
        ok: false,
        error: "too many requests; results are cached for " + CACHE_SECONDS + " seconds",
      })
    );
  }

  try {
    var payload = await buildResponse(req.query || {}, {
      fetchImpl: globalThis.fetch,
      now: Math.floor(Date.now() / 1000),
    });

    // A named agent that does not exist is a 404, not an empty registry. See
    // the note at the top of this file. The badge keeps its own rule — a grey
    // `unknown` at 200 — because it is an image in someone's README, where a
    // 404 renders as nothing at all.
    var wanted = (req.query || {}).agent;
    if (wanted && payload.counts.agents === 0) {
      res.statusCode = 404;
      res.setHeader("cache-control", "public, s-maxage=" + CACHE_SECONDS);
      res.setHeader("x-equxi-status", "unknown");
      return res.end(
        JSON.stringify({
          ok: false,
          code: "AGENT_NOT_FOUND",
          error: "no agent account at " + wanted + " on " + payload.cluster,
          address: wanted,
          cluster: payload.cluster,
          program: payload.program,
        })
      );
    }

    res.statusCode = 200;
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

// Exposed for the unit tests, which drive these directly, and for /api/health,
// which reuses this RPC caller and the cluster map rather than restating them.
module.exports.CLUSTER_RPC = CLUSTER_RPC;
module.exports.PROGRAM_ID = L.PROGRAM_ID;
module.exports.buildResponse = buildResponse;
module.exports.createRpc = createRpc;
module.exports.createRpcWithFallback = createRpcWithFallback;
module.exports.assembleRegistry = assembleRegistry;
module.exports.fetchAccounts = fetchAccounts;
module.exports.fetchOne = fetchOne;
