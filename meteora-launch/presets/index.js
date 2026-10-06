/**
 * meteora-launch/presets — published DBC config presets.
 *
 * A preset is the configuration half of a Meteora Dynamic Bonding Curve launch,
 * written down as data instead of buried in a script. The point is the one
 * Meteora's sidetrack asks for: a config a builder can read, trust, and reuse.
 *
 *   const presets = require("./presets");
 *   const preset = presets.loadPreset("safety-escrow");   // throws on a bad preset
 *   const report = presets.validatePreset(preset);        // { ok, errors[] }
 *
 * This module is deliberately dependency-free: it reads JSON, checks invariants,
 * and returns a verdict. Mapping the enum-name strings onto the DBC SDK's enum
 * members is the launcher's job (`../launch-safety-bond.js`), because that is
 * the only place the SDK is installed.
 *
 * The invariants below are the ones a wrong value breaks *silently* — a fee
 * percentage above 100, a curve whose weights do not match its price points, an
 * ordering assumption that costs a creator their trading fees. Everything a
 * caller could catch from the SDK's own type errors is left to the SDK.
 */
"use strict";

var fs = require("fs");
var path = require("path");

/** Every preset in this directory is for this protocol's escrow step. */
var PROTOCOL = "equxi";

/** The only migration target where the safety-escrow step can claim proceeds. */
var REQUIRED_MIGRATION = "met_damm_v2";

/**
 * Dotted paths whose value is the *name* of a DBC SDK enum member, not a
 * literal. Kept here so a preset cannot quietly drop one, and so a reviewer can
 * see exactly which fields the launcher has to resolve.
 */
var ENUM_FIELDS = [
  "token.tokenType",
  "token.tokenAuthorityOption",
  "fee.baseFeeMode",
  "fee.collectFeeMode",
  "migration.migrationOption",
  "migration.migrationFeeOption",
  "migration.migratedPoolFee.collectFeeMode",
  "migration.migratedPoolFee.dynamicFee",
  "migration.migratedPoolFee.baseFeeMode",
  "curve.activationType",
];

/** Read a dotted path without throwing on a missing branch. */
function get(object, dotted) {
  var node = object;
  var parts = dotted.split(".");
  for (var i = 0; i < parts.length; i++) {
    if (node === null || node === undefined || typeof node !== "object") return undefined;
    node = node[parts[i]];
  }
  return node;
}

function isInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.floor(value) === value;
}

/** True when every element is a finite number and each is larger than the last. */
function isStrictlyIncreasing(list) {
  if (!Array.isArray(list) || list.length < 2) return false;
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i] !== "number" || !Number.isFinite(list[i])) return false;
    if (i > 0 && list[i] <= list[i - 1]) return false;
  }
  return true;
}

/**
 * Check a preset against the invariants a wrong value breaks silently.
 * Never throws: a caller gets `{ ok, errors }` and decides what to do.
 */
function validatePreset(preset) {
  var errors = [];

  function fail(message) {
    errors.push(message);
  }

  if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
    return { ok: false, errors: ["preset must be an object"] };
  }

  if (typeof preset.name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.name)) {
    fail("name must be a kebab-case string");
  }
  if (!isInteger(preset.version) || preset.version < 1) fail("version must be an integer >= 1");
  if (typeof preset.summary !== "string" || !preset.summary.trim()) fail("summary is required");

  // token
  if (!isInteger(get(preset, "token.totalTokenSupply")) || get(preset, "token.totalTokenSupply") <= 0) {
    fail("token.totalTokenSupply must be a positive integer");
  }
  ["token.tokenBaseDecimal", "token.tokenQuoteDecimal"].forEach(function (field) {
    var value = get(preset, field);
    if (!isInteger(value) || value < 0 || value > 18) fail(field + " must be an integer 0..18");
  });

  // fee — a percentage over 100 is the classic silent break
  var creatorTradingFee = get(preset, "fee.creatorTradingFeePercentage");
  if (!isInteger(creatorTradingFee) || creatorTradingFee < 0 || creatorTradingFee > 100) {
    fail("fee.creatorTradingFeePercentage must be an integer 0..100");
  }
  ["fee.startingFeeBps", "fee.endingFeeBps"].forEach(function (field) {
    var value = get(preset, field);
    if (!isInteger(value) || value < 0) fail(field + " must be an integer >= 0");
  });

  // migration
  var migrationOption = get(preset, "migration.migrationOption");
  if (migrationOption !== REQUIRED_MIGRATION) {
    fail("migration.migrationOption must be \"" + REQUIRED_MIGRATION + "\"");
  }
  var migrationFeePercentage = get(preset, "migration.migrationFee.feePercentage");
  if (
    typeof migrationFeePercentage !== "number" ||
    !Number.isFinite(migrationFeePercentage) ||
    migrationFeePercentage < 0 ||
    migrationFeePercentage > 100
  ) {
    fail("migration.migrationFee.feePercentage must be a number 0..100");
  }
  var migrationCreatorFee = get(preset, "migration.migrationFee.creatorFeePercentage");
  if (
    typeof migrationCreatorFee !== "number" ||
    !Number.isFinite(migrationCreatorFee) ||
    migrationCreatorFee < 0 ||
    migrationCreatorFee > 100
  ) {
    fail("migration.migrationFee.creatorFeePercentage must be a number 0..100");
  }
  var poolFeeBps = get(preset, "migration.migratedPoolFee.poolFeeBps");
  if (!isInteger(poolFeeBps) || poolFeeBps <= 0) {
    fail("migration.migratedPoolFee.poolFeeBps must be a positive integer");
  }

  // curve — weights must describe the segments between the price points
  var sqrtPrices = get(preset, "curve.sqrtPrices");
  if (!isStrictlyIncreasing(sqrtPrices)) {
    fail("curve.sqrtPrices must be at least two finite numbers, strictly increasing");
  }
  var weights = get(preset, "curve.liquidityWeights");
  if (!Array.isArray(weights) || !weights.length) {
    fail("curve.liquidityWeights must be a non-empty array");
  } else {
    weights.forEach(function (value, i) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        fail("curve.liquidityWeights[" + i + "] must be a positive number");
      }
    });
    if (Array.isArray(sqrtPrices) && weights.length !== sqrtPrices.length - 1) {
      fail("curve.liquidityWeights must have one entry per segment (sqrtPrices.length - 1)");
    }
  }

  // escrow — what makes this a safety-escrow preset and not a plain DBC config
  if (get(preset, "escrow.protocol") !== PROTOCOL) {
    fail("escrow.protocol must be \"" + PROTOCOL + "\"");
  }
  var bondLamports = get(preset, "escrow.bondLamports");
  if (!isInteger(bondLamports) || bondLamports <= 0) {
    fail("escrow.bondLamports must be a positive integer");
  }
  var fundedBy = get(preset, "escrow.fundedBy");
  if (typeof fundedBy !== "string" || fundedBy.indexOf("migrationFee") === -1) {
    fail("escrow.fundedBy must name the config path the proceeds come from");
  }

  // ordering — the one step the chain taught us, encoded so it cannot be lost
  if (get(preset, "ordering.mustClaimTradingFeesBeforeMigration") !== true) {
    fail("ordering.mustClaimTradingFeesBeforeMigration must be true");
  }

  // every enum slot must still name something
  ENUM_FIELDS.forEach(function (field) {
    var value = get(preset, field);
    if (typeof value !== "string" || !value.trim()) fail(field + " must name a DBC SDK enum member");
  });

  return { ok: errors.length === 0, errors: errors };
}

/** Read and validate one preset by name. Throws with every reason it failed. */
function loadPreset(name) {
  if (typeof name !== "string" || !name.trim()) throw new Error("loadPreset: a preset name is required");
  if (name.indexOf("/") !== -1 || name.indexOf("\\") !== -1 || name.indexOf("..") !== -1) {
    throw new Error("loadPreset: name must be a bare preset name");
  }

  var file = path.join(__dirname, name + ".json");
  var raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error("loadPreset: no preset named \"" + name + "\" (" + file + ")");
  }

  var preset;
  try {
    preset = JSON.parse(raw);
  } catch (error) {
    throw new Error("loadPreset: " + name + ".json is not valid JSON: " + error.message);
  }

  var report = validatePreset(preset);
  if (!report.ok) {
    throw new Error("loadPreset: " + name + " is invalid:\n  - " + report.errors.join("\n  - "));
  }
  return preset;
}

/** The presets published here, by name, sorted. */
function listPresets() {
  return fs
    .readdirSync(__dirname)
    .filter(function (file) {
      return file.slice(-5) === ".json";
    })
    .map(function (file) {
      return file.slice(0, -5);
    })
    .sort();
}

module.exports = {
  PROTOCOL: PROTOCOL,
  REQUIRED_MIGRATION: REQUIRED_MIGRATION,
  ENUM_FIELDS: ENUM_FIELDS,
  get: get,
  validatePreset: validatePreset,
  loadPreset: loadPreset,
  listPresets: listPresets,
};
