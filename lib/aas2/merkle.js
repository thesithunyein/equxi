/**
 * lib/aas2/merkle.js — commit to results, not just rows.
 *
 * A plain Merkle root over records would prove a record existed. It would not
 * prove that record *failed a check*, which is the only thing a dispute needs.
 * So each leaf commits to three things at once:
 *
 *     leaf_i = SHA-256(0x00 || JCS({record_i, checks_i, ruleset_hash}))
 *
 * Because the leaf carries the ruleset hash, a proof cannot be replayed under a
 * different ruleset, and because it carries the per-record booleans, a party can
 * show record 16 failed `unique` without revealing the other 19 rows.
 *
 * Odd levels promote the last node unchanged (RFC 6962), rather than hashing it
 * with itself. Duplicating the last node is the CVE-2012-2459 shape, where two
 * different trees share a root; promotion does not have that collision.
 *
 * The prefix bytes stop a leaf from ever being interpretable as an internal node.
 */
"use strict";

var canonical = require("./canonical.js");

var Aas2Error = canonical.Aas2Error;
var jcs = canonical.jcs;
var sha256 = canonical.sha256;
var hashDigest = canonical.hashDigest;
var hashToBytes = canonical.hashToBytes;

function leafPayload(record, perRecordChecks, rulesetHash) {
  var checks = {};
  Object.keys(perRecordChecks || {}).forEach(function (id) {
    var value = perRecordChecks[id];
    if (value === true || value === false) checks[id] = value;
  });

  return { record: record, checks: checks, ruleset: rulesetHash };
}

function leafHash(record, perRecordChecks, rulesetHash) {
  var body = Buffer.from(jcs(leafPayload(record, perRecordChecks, rulesetHash)), "utf8");
  return sha256(Buffer.concat([Buffer.from([0x00]), body]));
}

function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

/**
 * Builds every level, which is what a proof needs later. The root is the last
 * level's only node.
 */
function buildTree(records, perRecord, rulesetHash) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Aas2Error("merkle_empty", "a Merkle tree needs at least one record");
  }

  var leaves = records.map(function (record, index) {
    return leafHash(record, perRecord[index] || {}, rulesetHash);
  });

  var levels = [leaves];
  var current = leaves;

  while (current.length > 1) {
    var next = [];
    for (var i = 0; i < current.length; i += 2) {
      if (i + 1 === current.length) next.push(current[i]);
      else next.push(nodeHash(current[i], current[i + 1]));
    }
    levels.push(next);
    current = next;
  }

  return {
    levels: levels,
    leaves: leaves,
    root: levels[levels.length - 1][0],
  };
}

/** Sibling hashes from leaf to root, tagged with the side the sibling sits on. */
function buildProof(tree, index) {
  if (!Number.isInteger(index) || index < 0 || index >= tree.leaves.length) {
    throw new Aas2Error("merkle_bad_index", "record index out of range: " + index);
  }

  var proof = [];
  var position = index;

  for (var level = 0; level < tree.levels.length - 1; level += 1) {
    var nodes = tree.levels[level];

    if (position % 2 === 0) {
      if (position + 1 < nodes.length) {
        proof.push({ side: "right", hash: hashDigest(nodes[position + 1]) });
      }
    } else {
      proof.push({ side: "left", hash: hashDigest(nodes[position - 1]) });
    }

    position = Math.floor(position / 2);
  }

  return proof;
}

function verifyProof(leaf, proof, root) {
  if (!Array.isArray(proof)) {
    throw new Aas2Error("merkle_bad_proof", "proof must be an array");
  }

  var accumulator = hashToBytes(leaf);

  proof.forEach(function (step, index) {
    if (!step || (step.side !== "left" && step.side !== "right")) {
      throw new Aas2Error("merkle_bad_proof", "proof step " + index + " has no valid side");
    }

    var sibling = hashToBytes(step.hash);
    accumulator =
      step.side === "left" ? nodeHash(sibling, accumulator) : nodeHash(accumulator, sibling);
  });

  return hashDigest(accumulator) === root;
}

module.exports = {
  leafPayload: leafPayload,
  leafHash: leafHash,
  nodeHash: nodeHash,
  buildTree: buildTree,
  buildProof: buildProof,
  verifyProof: verifyProof,
};
