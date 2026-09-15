/**
 * Equxi wire format — dependency-free, runs in Node and in a browser.
 *
 * ## Why this file is CommonJS and has no imports
 *
 * This is loaded by the Vercel function in `api/trust.js`, which runs with no
 * build step (`vercel.json` sets `"buildCommand": null`). Adding a TypeScript
 * import or a package dependency here would mean either a build or a cold-start
 * cost, so the module is deliberately plain: no `require`, no `@solana/web3.js`,
 * no `Buffer` (browsers do not have it).
 *
 * ## Why the layouts are duplicated from Rust at all
 *
 * They are not duplicated from Rust — Rust is the original. This file is the
 * JavaScript restatement of it, and it exists because the deployed site is a
 * static JSON-RPC client with nowhere to run generated code. The thing that
 * keeps it honest is not discipline, it is `tests/unit/api.test.ts`, which pins
 * every discriminator, every field offset, and every record size against the
 * independently written decoder in `eliza-plugin/src/coder.ts`. If this file
 * drifts, that test goes red.
 */

"use strict";

/* ── Program constants ────────────────────────────────────────────────── */

var PROGRAM_ID = "D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc";

/** Default RPC. Overridable per-invocation so the API is not devnet-locked. */
var DEFAULT_RPC = "https://api.devnet.solana.com";

var LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Account discriminators, exactly as `anchor build` emits them into the IDL:
 * the first 8 bytes of `sha256("account:" + PascalCaseName)`.
 */
var ACCOUNT_DISCRIMINATORS = {
  Config: [155, 12, 170, 224, 30, 250, 204, 130],
  Vault: [211, 8, 232, 43, 2, 152, 117, 119],
  Agent: [47, 166, 112, 147, 155, 197, 86, 7],
  Bond: [224, 128, 48, 251, 182, 246, 111, 196],
  Constraint: [39, 48, 250, 220, 53, 120, 62, 128],
  SlashRecord: [107, 134, 175, 65, 150, 130, 94, 68],
};

/** Byte size of each account, discriminator included. */
var ACCOUNT_SIZES = {
  Config: 65,
  Vault: 25,
  Agent: 118,
  Bond: 106,
  Constraint: 339,
  SlashRecord: 259,
};

/**
 * `Agent` is the one account whose layout changed between deployments.
 *
 * v0.1 = 116 bytes, with `created_at` at offset 107.
 * v0.2 = 118 bytes, having inserted `constraint_count: u16` at offset 107 and
 *        pushed `created_at` to 109.
 *
 * Both are decoded, and the decoder reports which one it saw. This is not
 * speculative compatibility: the program deployed on devnet was measured at 116
 * bytes, so without this the read API returns a hard error against the live
 * program. The alternative — guessing at the length — is how a client silently
 * reports the wrong creation date.
 */
var AGENT_LAYOUT_V1_SIZE = 116;
var AGENT_LAYOUT_V2_SIZE = 118;

/**
 * Field offsets, in the order the Rust structs declare them.
 * Kept as data (not comments) so a test can assert against them.
 */
var OFFSETS = {
  // disc(8) owner(32) name(32) agent_type(1) trust_score(1) status(1)
  // bond_address(32) constraint_count(2) created_at(8) bumped(1)
  Agent: {
    owner: 8,
    name: 40,
    agentType: 72,
    trustScore: 73,
    status: 74,
    bondAddress: 75,
    constraintCount: 107,
    createdAt: 109,
  },
  // disc(8) agent(32) operator(32) amount(8) lock_duration(8) locked_at(8)
  // expires_at(8) is_active(1) bumped(1)
  Bond: {
    agent: 8,
    operator: 40,
    amount: 72,
    lockDuration: 80,
    lockedAt: 88,
    expiresAt: 96,
    isActive: 104,
  },
  // disc(8) agent(32) constraint_type(1) params(288) is_enforced(1)
  // created_at(8) bumped(1)
  Constraint: {
    agent: 8,
    constraintType: 40,
    params: 41,
    isEnforced: 329,
    createdAt: 330,
  },
  // disc(8) agent(32) authority(32) amount(8) reason(128) nonce(8)
  // timestamp(8) victim(1 + 32) compensated(1) bumped(1)
  SlashRecord: {
    agent: 8,
    authority: 40,
    amount: 72,
    reason: 80,
    reasonLength: 128,
    nonce: 208,
    timestamp: 216,
    victimTag: 224,
    victim: 225,
    compensated: 257,
  },
};

var AGENT_TYPE_NAMES = [
  "trader",
  "oracle",
  "defi",
  "payment",
  "nft",
  "governance",
  "bridge",
  "custom",
];

var AGENT_STATUS_NAMES = ["active", "pending", "slashed", "deactivated"];

var CONSTRAINT_TYPE_NAMES = [
  "spend_limit",
  "program_allowlist",
  "timelock",
  "velocity",
  "custom",
];

/* ── base58 ───────────────────────────────────────────────────────────── */

var B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var B58_INDEX = (function () {
  var map = {};
  for (var i = 0; i < B58_ALPHABET.length; i++) map[B58_ALPHABET[i]] = i;
  return map;
})();

/**
 * base58 encode, Bitcoin alphabet.
 *
 * `digits` starts empty rather than `[0]` on purpose: seeding a zero digit
 * appends one extra leading "1" to every key, which is the exact off-by-one
 * that makes `memcmp` filters miss and look like "this account type is empty".
 */
function bs58Encode(bytes) {
  var zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  var digits = [];
  for (var i = zeros; i < bytes.length; i++) {
    var carry = bytes[i];
    for (var j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  var out = "";
  for (var z = 0; z < zeros; z++) out += "1";
  for (var k = digits.length - 1; k >= 0; k--) out += B58_ALPHABET[digits[k]];
  return out;
}

function bs58Decode(str) {
  var zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;

  var bytes = [0];
  for (var i = zeros; i < str.length; i++) {
    var value = B58_INDEX[str[i]];
    if (value === undefined) throw new Error("invalid base58 character: " + str[i]);
    var carry = value;
    for (var j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  var out = new Uint8Array(zeros + bytes.length - (bytes.length === 1 && bytes[0] === 0 ? 1 : 0));
  var pos = zeros;
  for (var m = bytes.length - 1; m >= 0; m--) {
    if (m === bytes.length - 1 && bytes[m] === 0 && zeros > 0) continue;
    out[pos++] = bytes[m];
  }
  return out;
}

/** True when `s` decodes to exactly 32 bytes. Used to validate query params. */
function isPubkey(s) {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return bs58Decode(s).length === 32;
  } catch (e) {
    return false;
  }
}

/* ── filters ──────────────────────────────────────────────────────────── */

function discriminatorFilter(name) {
  var disc = ACCOUNT_DISCRIMINATORS[name];
  if (!disc) throw new Error("unknown account: " + name);
  return { memcmp: { offset: 0, bytes: bs58Encode(disc) } };
}

function pubkeyFilter(pubkey, offset) {
  return { memcmp: { offset: offset, bytes: pubkey } };
}

/* ── decoding ─────────────────────────────────────────────────────────── */

function view(data) {
  var bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function assertLength(data, min, what) {
  if (!data || data.length < min) {
    throw new Error(
      what + " account is " + (data ? data.length : 0) + " bytes, expected at least " + min
    );
  }
}

function pubkeyAt(dv, offset) {
  var bytes = new Uint8Array(32);
  for (var i = 0; i < 32; i++) bytes[i] = dv.getUint8(offset + i);
  return bs58Encode(bytes);
}

function fixedString(dv, offset, length) {
  var out = "";
  for (var i = 0; i < length; i++) {
    var c = dv.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  // The on-chain field is UTF-8; decode the accumulated bytes properly.
  try {
    return decodeURIComponent(escape(out));
  } catch (e) {
    return out;
  }
}

function decodeConfig(data) {
  assertLength(data, ACCOUNT_SIZES.Config, "Config");
  var dv = view(data);
  return {
    admin: pubkeyAt(dv, 8),
    totalAgents: Number(dv.getBigUint64(40, true)),
    totalBonds: Number(dv.getBigUint64(48, true)),
    totalSlashed: Number(dv.getBigUint64(56, true)),
    bumped: dv.getUint8(64),
  };
}

function decodeVault(data) {
  assertLength(data, ACCOUNT_SIZES.Vault, "Vault");
  var dv = view(data);
  var slashed = dv.getBigUint64(8, true);
  var compensated = dv.getBigUint64(16, true);
  return {
    totalSlashedLamports: slashed.toString(),
    totalCompensatedLamports: compensated.toString(),
    availableLamports: (slashed > compensated ? slashed - compensated : 0n).toString(),
    bumped: dv.getUint8(24),
  };
}

function decodeAgent(data) {
  if (!data || data.length < AGENT_LAYOUT_V1_SIZE) {
    throw new Error(
      "Agent account is " +
        (data ? data.length : 0) +
        " bytes, expected at least " +
        AGENT_LAYOUT_V1_SIZE
    );
  }

  // Length selects the layout. Anything at least as large as v0.2 is v0.2.
  var isV2 = data.length >= AGENT_LAYOUT_V2_SIZE;
  var dv = view(data);
  var o = OFFSETS.Agent;
  // v0.1 had no constraint counter, so every field after `bond_address` sits
  // two bytes earlier than in v0.2.
  var createdAtOffset = isV2 ? o.createdAt : o.createdAt - 2;

  return {
    layout: isV2 ? "v2" : "v1",
    owner: pubkeyAt(dv, o.owner),
    name: fixedString(dv, o.name, 32),
    agentType: AGENT_TYPE_NAMES[dv.getUint8(o.agentType)] || "custom",
    trustScore: dv.getUint8(o.trustScore),
    status: AGENT_STATUS_NAMES[dv.getUint8(o.status)] || "unknown",
    statusCode: dv.getUint8(o.status),
    bondAddress: pubkeyAt(dv, o.bondAddress),
    // v0.1 has no constraint counter, so "unknown" is reported as 0 rather
    // than reading two bytes of `created_at` and calling it a count.
    constraintCount: isV2 ? dv.getUint16(o.constraintCount, true) : 0,
    createdAt: Number(dv.getBigInt64(createdAtOffset, true)),
  };
}

function decodeBond(data) {
  assertLength(data, ACCOUNT_SIZES.Bond, "Bond");
  var dv = view(data);
  var o = OFFSETS.Bond;
  var amount = dv.getBigUint64(o.amount, true);
  return {
    agent: pubkeyAt(dv, o.agent),
    operator: pubkeyAt(dv, o.operator),
    amountLamports: amount.toString(),
    amountSol: Number(amount) / LAMPORTS_PER_SOL,
    lockDuration: Number(dv.getBigInt64(o.lockDuration, true)),
    lockedAt: Number(dv.getBigInt64(o.lockedAt, true)),
    expiresAt: Number(dv.getBigInt64(o.expiresAt, true)),
    isActive: dv.getUint8(o.isActive) === 1,
  };
}

function decodeConstraint(data) {
  assertLength(data, ACCOUNT_SIZES.Constraint, "Constraint");
  var dv = view(data);
  var o = OFFSETS.Constraint;
  var allowed = [];
  for (var i = 0; i < 8; i++) {
    var pk = pubkeyAt(dv, o.params + 32 + i * 32);
    if (pk !== "11111111111111111111111111111111") allowed.push(pk);
  }
  return {
    agent: pubkeyAt(dv, o.agent),
    constraintType: CONSTRAINT_TYPE_NAMES[dv.getUint8(o.constraintType)] || "custom",
    params: {
      maxAmountLamports: dv.getBigUint64(o.params, true).toString(),
      maxPerPeriod: dv.getBigUint64(o.params + 8, true).toString(),
      periodSeconds: Number(dv.getBigInt64(o.params + 16, true)),
      timelockSeconds: Number(dv.getBigInt64(o.params + 24, true)),
      allowedPrograms: allowed,
    },
    isEnforced: dv.getUint8(o.isEnforced) === 1,
    createdAt: Number(dv.getBigInt64(o.createdAt, true)),
  };
}

function decodeSlashRecord(data) {
  assertLength(data, ACCOUNT_SIZES.SlashRecord, "SlashRecord");
  var dv = view(data);
  var o = OFFSETS.SlashRecord;
  var amount = dv.getBigUint64(o.amount, true);
  var victimTag = dv.getUint8(o.victimTag);
  return {
    agent: pubkeyAt(dv, o.agent),
    authority: pubkeyAt(dv, o.authority),
    amountLamports: amount.toString(),
    amountSol: Number(amount) / LAMPORTS_PER_SOL,
    reason: fixedString(dv, o.reason, o.reasonLength),
    nonce: dv.getBigUint64(o.nonce, true).toString(),
    timestamp: Number(dv.getBigInt64(o.timestamp, true)),
    victim: victimTag === 1 ? pubkeyAt(dv, o.victim) : null,
    compensated: dv.getUint8(o.compensated) === 1,
  };
}

/* ── derived trust profile ────────────────────────────────────────────── */

/**
 * Score an agent from observable on-chain evidence only.
 *
 * The on-chain `trust_score` field is set by the program admin via
 * `update_trust_score`, so it is reported but never used as input. Everything
 * below comes from collateral and settlement history, which a counterparty can
 * verify independently.
 */
function buildTrustProfile(opts) {
  var agent = opts.agent;
  var bond = opts.bond;
  var slashes = opts.slashes || [];
  var now = opts.now;

  var warnings = [];
  var sorted = slashes.slice().sort(function (a, b) {
    var x = BigInt(a.nonce);
    var y = BigInt(b.nonce);
    if (x < y) return -1;
    if (x > y) return 1;
    return 0;
  });

  var totalSlashed = 0n;
  var compensated = 0n;
  var openSlashes = 0;
  for (var i = 0; i < sorted.length; i++) {
    var amt = BigInt(sorted[i].amountLamports);
    totalSlashed += amt;
    if (sorted[i].compensated) compensated += amt;
    else openSlashes++;
  }

  var hasStake = !!bond && BigInt(bond.amountLamports) > 0n;

  // Every deduction is recorded as a ledger entry as well as applied to the
  // score, so a counterparty can check the arithmetic instead of trusting the
  // total. The entries are the single source of truth: `score` is their sum, and
  // `tests/unit/layout.test.ts` asserts `score === sum(points)` for every case —
  // including the floor case, which needs the clamp recorded as a real entry for
  // the sum to still hold.
  var breakdown = [{ label: "Base score", points: 100 }];
  function deduct(points, label) {
    breakdown.push({ label: label, points: -points });
  }

  if (!hasStake) {
    deduct(
      45,
      bond
        ? "Bond holds zero lamports — nothing is at stake"
        : "No bond posted — nothing is at stake"
    );
    warnings.push(
      bond
        ? "Bond holds zero lamports — there is nothing at stake for this agent."
        : "No bond posted — there is nothing at stake for this agent."
    );
  } else if (!bond.isActive) {
    deduct(20, "Bond account exists but is marked inactive");
    warnings.push("Bond account exists but is marked inactive.");
  }

  if (agent.statusCode === 2) {
    deduct(15, "Agent is flagged Slashed on chain");
    warnings.push("Agent is flagged Slashed on chain.");
  } else if (agent.statusCode === 1) {
    deduct(5, "Agent is still Pending, not yet active");
    warnings.push("Agent is still Pending — not yet active.");
  } else if (agent.statusCode === 3) {
    warnings.push("Agent is Deactivated; its bond tells you nothing new.");
  }

  if (sorted.length > 0) {
    var slashCapped = sorted.length * 10 > 40;
    deduct(
      Math.min(sorted.length * 10, 40),
      sorted.length +
        " slash" +
        (sorted.length === 1 ? "" : "es") +
        " recorded (10 each" +
        (slashCapped ? ", capped at 40" : "") +
        ")"
    );
  }

  if (openSlashes > 0) {
    var openCapped = openSlashes * 12 > 30;
    deduct(
      Math.min(openSlashes * 12, 30),
      openSlashes +
        " slash" +
        (openSlashes === 1 ? "" : "es") +
        " not yet compensated (12 each" +
        (openCapped ? ", capped at 30" : "") +
        ")"
    );
    warnings.push(
      openSlashes +
        " slash" +
        (openSlashes === 1 ? "" : "es") +
        " recorded but not yet compensated — the victim is still owed."
    );
  }

  if (bond && BigInt(bond.amountLamports) < BigInt(LAMPORTS_PER_SOL)) {
    deduct(8, "Bond under 1 SOL — thin for real counterparty risk");
    warnings.push("Bond is under 1 SOL — enough to register, thin for real counterparty risk.");
  }

  var rawScore = breakdown.reduce(function (sum, entry) {
    return sum + entry.points;
  }, 0);
  var score = Math.max(0, Math.min(100, rawScore));
  if (score !== rawScore) {
    // Record the clamp itself. Without this an audited total would not add up,
    // and "the number is checkable" is the entire claim this page makes.
    breakdown.push({
      label:
        rawScore < 0
          ? "Deductions total " + rawScore + ", and the score floors at 0"
          : "Deductions total " + rawScore + ", and the score caps at 100",
      points: score - rawScore,
    });
  }

  var grade;
  if (!hasStake) grade = "ungraded";
  else if (score >= 90) grade = "A";
  else if (score >= 75) grade = "B";
  else if (score >= 55) grade = "C";
  else if (score >= 30) grade = "D";
  else grade = "F";

  if (agent.trustScore !== score) {
    warnings.push(
      "On-chain trust_score is " +
        agent.trustScore +
        "; the derived score is " +
        score +
        ". These are different numbers by design — the on-chain value is admin-set and is not evidence."
    );
  }

  var slashRatePerMonth = 0;
  if (sorted.length > 0) {
    var span = Math.max(now - sorted[0].timestamp, 1);
    slashRatePerMonth = (sorted.length / span) * (30 * 24 * 60 * 60);
  }

  return {
    grade: grade,
    score: score,
    /** The deductions that produced `score`, summing exactly to it. */
    breakdown: breakdown,
    onChainTrustScore: agent.trustScore,
    bond: bond
      ? {
          amountLamports: bond.amountLamports,
          amountSol: bond.amountSol,
          lockedAt: bond.lockedAt,
          expiresAt: bond.expiresAt,
          isActive: bond.isActive,
          locked: now < bond.expiresAt,
          expired: now >= bond.expiresAt,
        }
      : null,
    slashes: sorted.map(function (s) {
      return {
        nonce: s.nonce,
        amountLamports: s.amountLamports,
        amountSol: s.amountSol,
        reason: s.reason,
        timestamp: s.timestamp,
        victim: s.victim,
        compensated: s.compensated,
      };
    }),
    stats: {
      slashCount: sorted.length,
      openSlashes: openSlashes,
      totalSlashedLamports: totalSlashed.toString(),
      totalSlashedSol: Number(totalSlashed) / LAMPORTS_PER_SOL,
      compensationPaidLamports: compensated.toString(),
      uncompensatedLamports: (totalSlashed - compensated).toString(),
      slashRatePerMonth: slashRatePerMonth,
    },
    warnings: warnings,
  };
}

module.exports = {
  PROGRAM_ID: PROGRAM_ID,
  DEFAULT_RPC: DEFAULT_RPC,
  LAMPORTS_PER_SOL: LAMPORTS_PER_SOL,
  ACCOUNT_DISCRIMINATORS: ACCOUNT_DISCRIMINATORS,
  ACCOUNT_SIZES: ACCOUNT_SIZES,
  AGENT_LAYOUT_V1_SIZE: AGENT_LAYOUT_V1_SIZE,
  AGENT_LAYOUT_V2_SIZE: AGENT_LAYOUT_V2_SIZE,
  OFFSETS: OFFSETS,
  AGENT_TYPE_NAMES: AGENT_TYPE_NAMES,
  AGENT_STATUS_NAMES: AGENT_STATUS_NAMES,
  CONSTRAINT_TYPE_NAMES: CONSTRAINT_TYPE_NAMES,
  bs58Encode: bs58Encode,
  bs58Decode: bs58Decode,
  isPubkey: isPubkey,
  discriminatorFilter: discriminatorFilter,
  pubkeyFilter: pubkeyFilter,
  decodeConfig: decodeConfig,
  decodeVault: decodeVault,
  decodeAgent: decodeAgent,
  decodeBond: decodeBond,
  decodeConstraint: decodeConstraint,
  decodeSlashRecord: decodeSlashRecord,
  buildTrustProfile: buildTrustProfile,
};
