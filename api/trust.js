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
 * | `rpc=<url>` | Explicit RPC endpoint (development only) |
 */
"use strict";

var L = require("../lib/equxi-layout.js");

var CLUSTER_RPC = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

/** Response cache. Reads are public and change slowly. */
var CACHE_SECONDS = 30;

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

/**
 * Minimal JSON-RPC caller. Solana's RPC is a `POST` of one JSON object.
 * `fetchImpl` is a parameter rather than the global so tests can drive it.
 */
function createRpc(rpcUrl, fetchImpl) {
  return async function call(method, params) {
    var response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
    });

    if (!response.ok) {
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
  var rpcUrl = query.rpc || CLUSTER_RPC[cluster];
  if (!rpcUrl) {
    throw Object.assign(new Error("unknown cluster: " + cluster), { status: 400 });
  }

  for (var i = 0; i < ["agent", "owner"].length; i++) {
    var key = ["agent", "owner"][i];
    if (query[key] && !L.isPubkey(query[key])) {
      throw Object.assign(new Error(key + " must be a base58-encoded 32-byte pubkey"), {
        status: 400,
      });
    }
  }

  var call = createRpc(rpcUrl, deps.fetchImpl);

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

  try {
    var payload = await buildResponse(req.query || {}, {
      fetchImpl: globalThis.fetch,
      now: Math.floor(Date.now() / 1000),
    });

    res.statusCode = 200;
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
module.exports.createRpc = createRpc;
module.exports.assembleRegistry = assembleRegistry;
module.exports.fetchAccounts = fetchAccounts;
module.exports.fetchOne = fetchOne;
