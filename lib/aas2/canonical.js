/**
 * lib/aas2/canonical.js — the byte-exact half of AAS-2.
 *
 * Two verifiers that disagree about a hash disagree about everything downstream:
 * the receipt, the anchors, the dispute. So every hash in AAS-2 is taken over a
 * canonical form, and this file is that canonical form in code.
 *
 * The rules are not invented here; each function names the clause it implements:
 *
 *   jcs()                 RFC 8785 JSON Canonicalization Scheme (§6.1)
 *   parseCsv()            RFC 4180, UTF-8, header-mapped (§6.2)
 *   tryNormalizeDecimal() canonical decimal strings, no floats (§6.3)
 *   canonicalRecords()    record canonical form (§6.4)
 *   hashJson()/hashBytes  the sha256:.. strings (§6.5)
 *
 * Deliberately no dependencies: the same code has to run in the CLI, in the
 * Vercel function, and in third-party implementations reading this as the
 * reference. `node:crypto` and `node:util` are the whole surface.
 *
 * A value that does not match its declared type is carried into the canonical
 * record unchanged and reported by `field_types`. Canonicalization is allowed to
 * succeed on bad business data; it is not allowed to succeed on bad structure.
 * That split is what lets a failing fixture produce a valid, signed receipt.
 */
"use strict";

var crypto = require("node:crypto");
var util = require("node:util");

/** A verification-stopping condition. `code` is stable and machine-readable. */
class Aas2Error extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "Aas2Error";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

var MAX_SIGNIFICANT_DIGITS = 30;
var utf8Strict = new util.TextDecoder("utf-8", { fatal: true });

/* ------------------------------------------------------------------ */
/* JSON Canonicalization Scheme (RFC 8785)                             */
/* ------------------------------------------------------------------ */

/**
 * JCS sorts object keys by UTF-16 code units. JavaScript's default string
 * comparison does exactly that, so no locale collation is involved.
 */
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function jcs(value) {
  if (value === null) return "null";

  var type = typeof value;
  if (type === "boolean") return value ? "true" : "false";

  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new Aas2Error("jcs_non_finite", "JCS cannot serialize a non-finite number");
    }
    // JSON.stringify uses the ECMAScript Number::toString algorithm, which is
    // the one RFC 8785 mandates. -0 serializes as "0".
    return JSON.stringify(value);
  }

  if (type === "string") return JSON.stringify(value);

  if (type === "bigint") {
    throw new Aas2Error("jcs_bigint", "JCS has no bigint; pass a canonical decimal string");
  }

  if (Array.isArray(value)) {
    return (
      "[" +
      value
        .map(function (item) {
          if (item === undefined) {
            throw new Aas2Error("jcs_undefined", "JCS cannot serialize undefined array items");
          }
          return jcs(item);
        })
        .join(",") +
      "]"
    );
  }

  if (type === "object") {
    var keys = Object.keys(value)
      .filter(function (key) {
        if (value[key] === undefined) {
          throw new Aas2Error("jcs_undefined", 'JCS cannot serialize undefined at key "' + key + '"');
        }
        return true;
      })
      .sort(compareCodeUnits);

    return (
      "{" +
      keys
        .map(function (key) {
          return JSON.stringify(key) + ":" + jcs(value[key]);
        })
        .join(",") +
      "}"
    );
  }

  throw new Aas2Error("jcs_unsupported", "JCS cannot serialize a " + type);
}

/* ------------------------------------------------------------------ */
/* Hashing (§6.5)                                                      */
/* ------------------------------------------------------------------ */

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest();
}

function hashBytes(bytes) {
  return "sha256:" + sha256(bytes).toString("hex");
}

/** Converts an existing 32-byte digest to its hash string. Never re-hashes. */
function hashDigest(digest) {
  if (!Buffer.isBuffer(digest) || digest.length !== 32) {
    throw new Aas2Error("bad_digest", "expected a 32-byte digest");
  }
  return "sha256:" + digest.toString("hex");
}

function hashText(text) {
  return hashBytes(Buffer.from(text, "utf8"));
}

function hashJson(value) {
  return hashText(jcs(value));
}

function isHash(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function hashToBytes(value) {
  if (!isHash(value)) {
    throw new Aas2Error("bad_hash", "expected a sha256:<64 hex> value, got " + String(value));
  }
  return Buffer.from(value.slice(7), "hex");
}

/* ------------------------------------------------------------------ */
/* Decimal normalization (§6.3)                                        */
/* ------------------------------------------------------------------ */

/**
 * Returns `{ok, value}` or `{ok:false, error}`. A non-ok result is a *field*
 * failure, not a verification error: the caller keeps the raw text and lets
 * `field_types` report it.
 */
function tryNormalizeDecimal(raw) {
  if (typeof raw !== "string") return { ok: false, error: "not a string" };
  if (raw === "") return { ok: false, error: "empty" };
  if (raw.trim() !== raw) return { ok: false, error: "surrounding whitespace" };

  var match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) return { ok: false, error: "not a plain decimal (no exponent, separators, or bare dot)" };

  var sign = match[1] === "-" ? "-" : "";
  var integer = match[2].replace(/^0+/, "");
  if (integer === "") integer = "0";
  var fraction = (match[3] || "").replace(/0+$/, "");

  var significant = (integer + fraction).replace(/^0+/, "");
  if (significant.length > MAX_SIGNIFICANT_DIGITS) {
    return { ok: false, error: "more than " + MAX_SIGNIFICANT_DIGITS + " significant digits" };
  }

  var normalized = integer + (fraction ? "." + fraction : "");
  if (normalized === "0") sign = "";

  return { ok: true, value: sign + normalized };
}

function normalizeDecimal(raw) {
  var result = tryNormalizeDecimal(raw);
  if (!result.ok) {
    throw new Aas2Error("bad_decimal", 'cannot canonicalize "' + String(raw) + '": ' + result.error);
  }
  return result.value;
}

/* ------------------------------------------------------------------ */
/* CSV parsing (RFC 4180) (§6.2)                                       */
/* ------------------------------------------------------------------ */

function decodeUtf8(input) {
  var text;

  if (typeof input === "string") {
    text = input;
  } else if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    try {
      text = utf8Strict.decode(input);
    } catch (error) {
      throw new Aas2Error("csv_not_utf8", "output is not valid UTF-8");
    }
  } else {
    throw new Aas2Error("csv_bad_input", "output must be a Buffer, Uint8Array, or string");
  }

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * A strict RFC 4180 reader: quotes only open at field start, escaped quotes are
 * `""`, CRLF and LF both end a record, embedded newlines stay in the field.
 * A file that violates those rules is a verification error, not a failed check,
 * because a lenient parser would let two implementations disagree silently.
 */
function parseCsvRows(text) {
  var rows = [];
  var row = [];
  var field = "";
  var inQuotes = false;
  var i = 0;

  while (i < text.length) {
    var ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (field !== "") {
        throw new Aas2Error("csv_bad_quote", "quote inside an unquoted field at offset " + i);
      }
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new Aas2Error("csv_unterminated_quote", "unterminated quoted field");
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses the output and maps it to the agreement's declared columns.
 *
 * Returns `{header, rows, extraColumns}` where each row is an object keyed by
 * declared field name. Rows shorter than the header are padded with empty
 * strings (a common export truncation); rows longer than the header are an
 * error, because that usually means an unescaped separator and guessing would
 * hide it.
 */
function parseCsv(input, declaredFields) {
  var text = decodeUtf8(input);
  var raw = parseCsvRows(text).filter(function (row) {
    return !(row.length === 1 && row[0] === "");
  });

  if (raw.length === 0) {
    throw new Aas2Error("csv_empty", "output has no header row");
  }

  var header = raw[0].map(function (name) {
    return name.normalize("NFC");
  });

  if (header.length === 0 || (header.length === 1 && header[0] === "")) {
    throw new Aas2Error("csv_empty_header", "output has an empty header row");
  }

  var seen = Object.create(null);
  header.forEach(function (name) {
    if (seen[name]) {
      throw new Aas2Error("csv_duplicate_header", 'duplicate header "' + name + '"');
    }
    seen[name] = true;
  });

  var missing = declaredFields.filter(function (field) {
    return !seen[field];
  });
  if (missing.length) {
    throw new Aas2Error("csv_missing_column", "declared column(s) missing: " + missing.join(", "), {
      missing: missing,
    });
  }

  var rows = raw.slice(1).map(function (cells, index) {
    if (cells.length > header.length) {
      throw new Aas2Error(
        "csv_row_too_wide",
        "record " + index + " has more fields (" + cells.length + ") than the header (" + header.length + ")"
      );
    }
    var record = {};
    for (var c = 0; c < header.length; c += 1) {
      record[header[c]] = cells[c] === undefined ? "" : cells[c];
    }
    return record;
  });

  var extraColumns = header.filter(function (name) {
    return declaredFields.indexOf(name) === -1;
  });

  return { header: header, rows: rows, extraColumns: extraColumns };
}

/* ------------------------------------------------------------------ */
/* Record canonical form (§6.4)                                        */
/* ------------------------------------------------------------------ */

function isValidDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * The type map comes from the agreement's `field_types` schema. A field with no
 * declared type is a string, which is the least surprising default: it is what
 * the raw cell already is.
 */
function typeMapOf(agreement) {
  var map = Object.create(null);
  var checks = (agreement && agreement.checks) || [];

  checks.forEach(function (check) {
    if (!check || check.id !== "field_types" || !check.schema) return;
    Object.keys(check.schema).forEach(function (field) {
      map[field] = check.schema[field];
    });
  });

  return map;
}

function canonicalValue(raw, type) {
  var value = String(raw).normalize("NFC");

  if (type === "decimal" || type === "integer") {
    var decimal = tryNormalizeDecimal(value);
    if (!decimal.ok) return value;
    if (type === "integer" && decimal.value.indexOf(".") !== -1) return value;
    return decimal.value;
  }

  if (type === "boolean") {
    var lower = value.toLowerCase();
    return lower === "true" || lower === "false" ? lower : value;
  }

  // An unparseable date is carried as text; `field_types` is where it fails.
  if (type === "date") return value;

  return value;
}

/**
 * Builds the canonical record array. Only declared fields enter the record:
 * the agreement fixes the deliverable, and an extra column is reported rather
 * than hashed, so re-exporting the same delivery with a stray `notes` column
 * does not change the commitment.
 */
function canonicalRecords(agreement, parsed) {
  var fields = (agreement && agreement.deliverable && agreement.deliverable.fields) || [];
  var types = typeMapOf(agreement);

  return parsed.rows.map(function (row) {
    var record = {};
    fields.forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) return;
      record[field] = canonicalValue(row[field], types[field] || "string");
    });
    return record;
  });
}

module.exports = {
  Aas2Error: Aas2Error,
  MAX_SIGNIFICANT_DIGITS: MAX_SIGNIFICANT_DIGITS,
  jcs: jcs,
  sha256: sha256,
  hashBytes: hashBytes,
  hashDigest: hashDigest,
  hashText: hashText,
  hashJson: hashJson,
  isHash: isHash,
  hashToBytes: hashToBytes,
  tryNormalizeDecimal: tryNormalizeDecimal,
  normalizeDecimal: normalizeDecimal,
  decodeUtf8: decodeUtf8,
  parseCsvRows: parseCsvRows,
  parseCsv: parseCsv,
  isValidDate: isValidDate,
  typeMapOf: typeMapOf,
  canonicalValue: canonicalValue,
  canonicalRecords: canonicalRecords,
};
