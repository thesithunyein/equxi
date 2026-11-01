/**
 * lib/aas2/keys.js — Ed25519 over SHA-256(domain || 0x00 || JCS(payload)).
 *
 * The hash-then-sign construction is not decoration. Ed25519 signs a message it
 * hashes internally, so signing JCS bytes directly would sign a different byte
 * string in every implementation that disagrees on whitespace. Hashing first
 * makes the signed message exactly 32 bytes, and the domain prefix makes a
 * receipt signature worthless as an agreement signature even though one key can
 * in principle sign both.
 *
 * The 0x00 separator stops a domain that ends in a valid JSON prefix from being
 * extended into a different domain by moving bytes across the boundary.
 *
 * Keys are exchanged as base64 of the raw 32-byte public key, because that fits
 * in a URL, a memo, and a JSON field. PEM is accepted for private keys so the
 * operator can keep one in a file rather than an env var.
 */
"use strict";

var crypto = require("node:crypto");
var canonical = require("./canonical.js");

var Aas2Error = canonical.Aas2Error;

/** DER prefix for an Ed25519 SubjectPublicKeyInfo with a 32-byte key. */
var SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

var DOMAINS = {
  agreement: "equxi/aas-2/agreement/v0.1",
  submission: "equxi/aas-2/submission/v0.1",
  receipt: "equxi/aas-2/receipt/v0.1",
  report: "equxi/aas-2/report/v0.1",
};

function generateKeyPair() {
  return crypto.generateKeyPairSync("ed25519");
}

function privateKeyFromPem(pem) {
  try {
    return crypto.createPrivateKey({ key: pem, format: "pem", type: "pkcs8" });
  } catch (error) {
    throw new Aas2Error("bad_private_key", "not a PKCS#8 Ed25519 private key: " + error.message);
  }
}

/** Raw 32-byte public key, base64. This is the value published in receipts. */
function publicKeyBase64(publicKeyObject) {
  var der = publicKeyObject.export({ type: "spki", format: "der" });
  if (der.length !== SPKI_PREFIX.length + 32) {
    throw new Aas2Error("bad_public_key", "not an Ed25519 public key");
  }
  return der.subarray(der.length - 32).toString("base64");
}

/** Accepts a PEM public key or base64 raw key, because both get pasted around. */
function publicKeyFrom(input) {
  if (input && typeof input === "object" && input.type === "public") return input;

  if (typeof input !== "string" || input === "") {
    throw new Aas2Error("bad_public_key", "public key must be a base64 string or a KeyObject");
  }

  if (input.indexOf("-----BEGIN") !== -1) {
    try {
      return crypto.createPublicKey({ key: input, format: "pem", type: "spki" });
    } catch (error) {
      throw new Aas2Error("bad_public_key", "unreadable PEM public key: " + error.message);
    }
  }

  var raw;
  try {
    raw = Buffer.from(input, "base64");
  } catch (error) {
    throw new Aas2Error("bad_public_key", "public key is not base64");
  }

  if (raw.length !== 32) {
    throw new Aas2Error("bad_public_key", "raw Ed25519 public key must be 32 bytes, got " + raw.length);
  }

  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function signingDigest(domain, payload) {
  if (typeof domain !== "string" || domain === "") {
    throw new Aas2Error("bad_domain", "signing domain is required");
  }

  var body = Buffer.from(canonical.jcs(payload), "utf8");
  return canonical.sha256(
    Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0x00]), body])
  );
}

function sign(privateKey, domain, payload) {
  return crypto.sign(null, signingDigest(domain, payload), privateKey).toString("base64");
}

/**
 * Returns false rather than throwing on a malformed signature: a receipt with a
 * bad signature is invalid, which is a verification result, not an exception.
 */
function verify(publicKeyInput, domain, payload, signatureBase64) {
  try {
    var key = publicKeyFrom(publicKeyInput);
    var signature = Buffer.from(String(signatureBase64), "base64");
    if (signature.length !== 64) return false;
    return crypto.verify(null, signingDigest(domain, payload), key, signature);
  } catch (error) {
    return false;
  }
}

module.exports = {
  DOMAINS: DOMAINS,
  generateKeyPair: generateKeyPair,
  privateKeyFromPem: privateKeyFromPem,
  publicKeyBase64: publicKeyBase64,
  publicKeyFrom: publicKeyFrom,
  signingDigest: signingDigest,
  sign: sign,
  verify: verify,
};
