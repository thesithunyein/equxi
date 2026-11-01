/**
 * lib/aas2/checks.js — the five v0.1 checks, and nothing else.
 *
 * Every check returns three things, because the receipt needs all three:
 *
 *   passed        a boolean for the check as a whole
 *   details       indices and counts only, safe for the public receipt
 *   privateDetails the same report plus values, for the hash-committed report
 *
 * Per-record booleans are returned separately in `perRecord`, one object per
 * record, keyed by check id. Those are what the Merkle leaves commit to. Checks
 * with `scope: "deliverable"` (record_count, deadline) produce no per-record
 * result; they are covered by the signed receipt core instead. Splitting it any
 * other way would make a count mismatch mark all twenty records as failed,
 * which is true of nothing.
 *
 * A check that cannot parse its own input throws. A check that parses and finds
 * a bad value returns a failure. That is the difference between "this receipt is
 * invalid" and "this delivery failed".
 */
"use strict";

var canonical = require("./canonical.js");

var Aas2Error = canonical.Aas2Error;

var CHECK_IDS = ["record_count", "required_fields", "field_types", "unique", "deadline"];
var RECORD_SCOPE = ["required_fields", "field_types", "unique"];
var TYPES = ["string", "integer", "decimal", "boolean", "date"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function has(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field);
}

/** Parses RFC 3339 with a mandatory offset. Returns milliseconds. */
function parseRfc3339(value, label) {
  if (typeof value !== "string") {
    throw new Aas2Error("bad_timestamp", label + " must be an RFC 3339 string");
  }

  var match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    throw new Aas2Error("bad_timestamp", label + " is not RFC 3339 with an offset: " + value);
  }

  var ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Aas2Error("bad_timestamp", label + " is not a real instant: " + value);
  }

  return ms;
}

/**
 * Rejects an agreement whose checks cannot be run deterministically. This is
 * about shape, not about pass/fail: a malformed check makes the agreement
 * unverifiable, so there is no receipt to issue.
 */
function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Aas2Error("agreement_no_checks", "the agreement must declare at least one check");
  }

  var seen = Object.create(null);

  checks.forEach(function (check, index) {
    if (!isPlainObject(check) || typeof check.id !== "string") {
      throw new Aas2Error("agreement_bad_check", "check " + index + " has no string id");
    }
    if (CHECK_IDS.indexOf(check.id) === -1) {
      throw new Aas2Error("agreement_unknown_check", 'unknown check id "' + check.id + '"');
    }
    if (seen[check.id]) {
      throw new Aas2Error("agreement_duplicate_check", 'check "' + check.id + '" appears twice');
    }
    seen[check.id] = true;

    if (check.id === "record_count") {
      if (!Number.isInteger(check.expected) || check.expected < 1) {
        throw new Aas2Error("agreement_bad_check", "record_count.expected must be an integer >= 1");
      }
    }

    if (check.id === "required_fields") {
      if (!Array.isArray(check.fields) || check.fields.length === 0) {
        throw new Aas2Error("agreement_bad_check", "required_fields.fields must be a non-empty array");
      }
    }

    if (check.id === "field_types") {
      if (!isPlainObject(check.schema) || Object.keys(check.schema).length === 0) {
        throw new Aas2Error("agreement_bad_check", "field_types.schema must be a non-empty object");
      }
      Object.keys(check.schema).forEach(function (field) {
        if (TYPES.indexOf(check.schema[field]) === -1) {
          throw new Aas2Error(
            "agreement_bad_check",
            'field_types.schema["' + field + '"] must be one of ' + TYPES.join(", ")
          );
        }
      });
    }

    if (check.id === "unique") {
      if (typeof check.field !== "string" || check.field === "") {
        throw new Aas2Error("agreement_bad_check", "unique.field must be a non-empty string");
      }
    }

    if (check.id === "deadline") {
      parseRfc3339(check.at, "deadline.at");
      var tolerance = check.tolerance_seconds === undefined ? 0 : check.tolerance_seconds;
      if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 300) {
        throw new Aas2Error("agreement_bad_check", "deadline.tolerance_seconds must be an integer 0..300");
      }
    }
  });

  return true;
}

/* ------------------------------------------------------------------ */
/* The five checks                                                     */
/* ------------------------------------------------------------------ */

function checkRecordCount(check, records) {
  var actual = records.length;
  var delta = actual - check.expected;

  return {
    id: "record_count",
    scope: "deliverable",
    passed: delta === 0,
    failed_count: delta === 0 ? 0 : 1,
    details: { expected: check.expected, actual: actual, delta: delta },
  };
}

function checkRequiredFields(check, records) {
  var failing = Object.create(null);
  var failedRecords = Object.create(null);
  var perRecord = [];

  check.fields.forEach(function (field) {
    failing[field] = [];
  });

  records.forEach(function (record, index) {
    var ok = true;

    check.fields.forEach(function (field) {
      var present = has(record, field) && record[field] !== null;
      var value = present ? String(record[field]).normalize("NFC") : "";
      if (!present || value.trim() === "") {
        failing[field].push(index);
        ok = false;
      }
    });

    if (!ok) failedRecords[index] = true;
    perRecord.push(ok);
  });

  // Empty field lists are noise in a public receipt; a passing field is absent.
  var details = {};
  Object.keys(failing).forEach(function (field) {
    if (failing[field].length) details[field] = failing[field];
  });

  return {
    id: "required_fields",
    scope: "record",
    passed: Object.keys(failedRecords).length === 0,
    failed_count: Object.keys(failedRecords).length,
    details: details,
    perRecord: perRecord,
  };
}

function matchesType(value, type) {
  var isPresent = value !== undefined && value !== null;
  if (!isPresent) return false;

  var text = String(value);

  if (type === "string") return true;
  if (type === "decimal") return canonical.tryNormalizeDecimal(text).ok;
  if (type === "integer") {
    var decimal = canonical.tryNormalizeDecimal(text);
    return decimal.ok && decimal.value.indexOf(".") === -1;
  }
  if (type === "boolean") return text === "true" || text === "false";
  if (type === "date") return canonical.isValidDate(text);

  return false;
}

function checkFieldTypes(check, records) {
  var publicDetails = {};
  var privateDetails = {};
  var perRecord = [];
  var failedCount = 0;

  records.forEach(function (record, index) {
    var ok = true;

    Object.keys(check.schema).forEach(function (field) {
      var type = check.schema[field];
      var present = has(record, field) && record[field] !== null;
      var value = present ? record[field] : null;

      if (present && matchesType(value, type)) return;

      ok = false;
      failedCount += 1;

      if (!publicDetails[field]) publicDetails[field] = [];
      publicDetails[field].push({ index: index, expected: type });

      if (!privateDetails[field]) privateDetails[field] = [];
      privateDetails[field].push({ index: index, value: value, expected: type });
    });

    perRecord.push(ok);
  });

  return {
    id: "field_types",
    scope: "record",
    passed: failedCount === 0,
    failed_count: failedCount,
    details: publicDetails,
    privateDetails: privateDetails,
    perRecord: perRecord,
  };
}

function checkUnique(check, records) {
  var groups = Object.create(null);
  var order = [];
  var extraRecords = Object.create(null);
  var perRecord = [];

  records.forEach(function (record, index) {
    if (!has(record, check.field) || record[check.field] === null) {
      perRecord.push(true);
      return;
    }

    var value = String(record[check.field]);
    if (!groups[value]) {
      groups[value] = { value: value, indices: [], extra: [] };
      order.push(value);
    }

    groups[value].indices.push(index);
    if (groups[value].indices.length > 1) {
      groups[value].extra.push(index);
      extraRecords[index] = true;
      perRecord.push(false);
      return;
    }

    perRecord.push(true);
  });

  var duplicates = order
    .map(function (value) {
      return groups[value];
    })
    .filter(function (group) {
      return group.extra.length > 0;
    });

  return {
    id: "unique",
    scope: "record",
    passed: duplicates.length === 0,
    failed_count: duplicates.reduce(function (sum, group) {
      return sum + group.extra.length;
    }, 0),
    details: (function () {
      var out = {};
      out[check.field] = duplicates.map(function (group) {
        return { indices: group.indices.slice(), extra: group.extra.slice() };
      });
      return out;
    })(),
    privateDetails: (function () {
      var out = {};
      out[check.field] = duplicates.map(function (group) {
        return { value: group.value, indices: group.indices.slice(), extra: group.extra.slice() };
      });
      return out;
    })(),
    perRecord: perRecord,
  };
}

function checkDeadline(check, submittedAt) {
  var atMs = parseRfc3339(check.at, "deadline.at");
  var submittedMs = parseRfc3339(submittedAt, "submitted_at");
  var tolerance = check.tolerance_seconds === undefined ? 0 : check.tolerance_seconds;
  var lateMs = submittedMs - (atMs + tolerance * 1000);
  var lateSeconds = lateMs > 0 ? lateMs / 1000 : 0;

  return {
    id: "deadline",
    scope: "deliverable",
    passed: lateMs <= 0,
    failed_count: lateMs <= 0 ? 0 : 1,
    details: {
      at: check.at,
      submitted_at: submittedAt,
      tolerance_seconds: tolerance,
      late_seconds: lateSeconds,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Runs the agreement's checks in the order the agreement declares them. That
 * order is signed, so it is deterministic across implementations even though
 * v0.1 happens to list them in a fixed order for readability.
 */
function runChecks(agreement, records, submittedAt) {
  validateChecks(agreement.checks);

  var perRecord = records.map(function () {
    return {};
  });

  var checkResults = agreement.checks.map(function (check) {
    var result;

    if (check.id === "record_count") result = checkRecordCount(check, records);
    else if (check.id === "required_fields") result = checkRequiredFields(check, records);
    else if (check.id === "field_types") result = checkFieldTypes(check, records);
    else if (check.id === "unique") result = checkUnique(check, records);
    else result = checkDeadline(check, submittedAt);

    if (RECORD_SCOPE.indexOf(result.id) !== -1) {
      result.perRecord.forEach(function (passed, index) {
        perRecord[index][result.id] = passed;
      });
    }

    return result;
  });

  var failedRecords = [];
  perRecord.forEach(function (results, index) {
    if (
      Object.keys(results).some(function (id) {
        return results[id] === false;
      })
    ) {
      failedRecords.push(index);
    }
  });

  var expected = agreement.deliverable.expected_count;
  agreement.checks.forEach(function (check) {
    if (check.id === "record_count") expected = check.expected;
  });

  var summary = {
    expected: expected,
    received: records.length,
    passed_records: records.length - failedRecords.length,
    failed_records: failedRecords,
    failed_record_count: failedRecords.length,
  };

  var verdict = checkResults.every(function (result) {
    return result.passed;
  })
    ? "passed"
    : "failed_checks";

  return {
    checks: checkResults,
    perRecord: perRecord,
    summary: summary,
    verdict: verdict,
  };
}

module.exports = {
  CHECK_IDS: CHECK_IDS,
  RECORD_SCOPE: RECORD_SCOPE,
  TYPES: TYPES,
  parseRfc3339: parseRfc3339,
  validateChecks: validateChecks,
  matchesType: matchesType,
  runChecks: runChecks,
};
