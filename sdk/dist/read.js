"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discriminatorFilter = discriminatorFilter;
exports.pubkeyFilter = pubkeyFilter;
exports.bs58Encode = bs58Encode;
exports.listAgents = listAgents;
exports.listBonds = listBonds;
exports.listSlashRecords = listSlashRecords;
exports.listConstraints = listConstraints;
exports.lamportsToSol = lamportsToSol;
exports.buildTrustProfile = buildTrustProfile;
/**
 * Anchor's account filters require the discriminator as a base58 string. Get
 * this wrong and `getProgramAccounts` silently returns an empty array for that
 * account type — which looks exactly like "no bonds exist" instead of "bug".
 */
function discriminatorFilter(discriminator, offset = 0) {
    if (discriminator.length !== 8) {
        throw new Error(`account discriminator must be 8 bytes, got ${discriminator.length}`);
    }
    return { memcmp: { offset, bytes: bs58Encode(discriminator) } };
}
/** Filter by a pubkey stored inside the account (e.g. `bond.agent`). */
function pubkeyFilter(pubkey, offset) {
    return { memcmp: { offset, bytes: pubkey.toBase58() } };
}
/**
 * base58 encode.
 *
 * Deliberately hand-rolled rather than imported: the SDK must not add a
 * dependency for 30 lines of arithmetic, and `bs58` is not a declared dep of
 * this package. Bitcoin's alphabet, big-integer long division.
 */
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(bytes) {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0)
        zeros++;
    // Start empty, not `[0]`. Seeding a zero digit renders one extra leading "1"
    // on every key, which is exactly the kind of off-by-one that would make
    // every `memcmp` filter miss and look like "this account type is empty".
    const digits = [];
    for (let i = zeros; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let out = "1".repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--)
        out += B58_ALPHABET[digits[i]];
    return out;
}
/* -------------------------------------------------------------------------- */
/* Raw queries                                                                */
/* -------------------------------------------------------------------------- */
/** Every agent the program has ever registered. */
async function listAgents(fetcher, programId, decoders, accountDiscriminators) {
    const raw = await fetcher.getProgramAccounts(programId, {
        filters: [discriminatorFilter(accountDiscriminators.Agent)],
    });
    return raw.map(({ pubkey, account }) => ({
        address: pubkey,
        data: decoders.agent(account.data),
    }));
}
/** Every bond in existence. */
async function listBonds(fetcher, programId, decoders, accountDiscriminators) {
    const raw = await fetcher.getProgramAccounts(programId, {
        filters: [discriminatorFilter(accountDiscriminators.Bond)],
    });
    return raw.map(({ pubkey, account }) => ({
        address: pubkey,
        data: decoders.bond(account.data),
    }));
}
/** Slash history for one agent, oldest nonce first. */
async function listSlashRecords(fetcher, programId, decoders, accountDiscriminators, agent) {
    const filters = [discriminatorFilter(accountDiscriminators.SlashRecord)];
    // `agent` is the first field after the discriminator.
    if (agent)
        filters.push(pubkeyFilter(agent, 8));
    const raw = await fetcher.getProgramAccounts(programId, { filters });
    return raw.map(({ pubkey, account }) => ({
        address: pubkey,
        data: decoders.slashRecord(account.data),
    }));
}
/** Constraints attached to one agent. */
async function listConstraints(fetcher, programId, decoders, accountDiscriminators, agent) {
    const filters = [discriminatorFilter(accountDiscriminators.Constraint)];
    if (agent)
        filters.push(pubkeyFilter(agent, 8));
    const raw = await fetcher.getProgramAccounts(programId, { filters });
    return raw.map(({ pubkey, account }) => ({
        address: pubkey,
        data: decoders.constraint(account.data),
    }));
}
const LAMPORTS_PER_SOL = 1000000000;
const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;
function lamportsToSol(lamports) {
    return Number(lamports) / LAMPORTS_PER_SOL;
}
/**
 * Build the public trust profile for one agent.
 *
 * The derived `score` intentionally ignores `agent.trustScore`: that field is
 * set by the program admin via `update_trust_score`, so it is an assertion, not
 * evidence. The score below is computed from things an observer can verify on
 * chain — whether collateral is actually posted, and whether past violations
 * were actually paid for. `warnings` records every place the evidence is thin
 * so the number is never presented as more than it is.
 */
function buildTrustProfile(input) {
    const { agent, bond, slashes, now } = input;
    const warnings = [];
    const sortedSlashes = [...slashes].sort((a, b) => Number(a.nonce - b.nonce));
    let totalSlashed = 0n;
    let compensated = 0n;
    let openSlashes = 0;
    for (const s of sortedSlashes) {
        totalSlashed += s.amount;
        if (s.compensated)
            compensated += s.amount;
        else
            openSlashes++;
    }
    const bondSummary = bond
        ? {
            address: bond.address.toBase58(),
            amountLamports: bond.amount,
            amountSol: lamportsToSol(bond.amount),
            lockedAt: bond.lockedAt,
            expiresAt: bond.expiresAt,
            isActive: bond.isActive,
            expired: now >= bond.expiresAt,
            locked: now < bond.expiresAt,
        }
        : null;
    const slashSummaries = sortedSlashes.map((s) => ({
        address: s.address.toBase58(),
        nonce: s.nonce,
        amountLamports: s.amount,
        amountSol: lamportsToSol(s.amount),
        reason: s.reason,
        timestamp: s.timestamp,
        victim: s.victim,
        compensated: s.compensated,
    }));
    // Slash rate over the observed window.
    let slashRatePerMonth = 0;
    if (sortedSlashes.length > 0) {
        const first = sortedSlashes[0].timestamp;
        const spanSeconds = Math.max(now - first, 1);
        slashRatePerMonth = (sortedSlashes.length / spanSeconds) * SECONDS_PER_MONTH;
    }
    const stats = {
        slashCount: slashSummaries.length,
        openSlashes,
        totalSlashedLamports: totalSlashed,
        compensationPaidLamports: compensated,
        uncompensatedLamports: totalSlashed - compensated,
        slashRatePerMonth,
    };
    /* --- scoring ---------------------------------------------------------- */
    // "Has stake" is the precondition for *any* grade. A bond account that
    // exists but holds zero lamports is not evidence of anything, so it must not
    // produce a numeric grade — otherwise a zero-collateral agent with a clean
    // history would score in the 50s and read as merely "average".
    const hasStake = bondSummary !== null && bondSummary.amountLamports > 0n;
    let score = 100;
    if (bondSummary === null || bondSummary.amountLamports === 0n) {
        // Nothing is at risk, so "trust" here means nothing. This is the single
        // most common way a trust score lies, so it dominates the grade.
        score -= 45;
        warnings.push(bondSummary === null
            ? "No bond posted — there is nothing at stake for this agent."
            : "Bond holds zero lamports — there is nothing at stake for this agent.");
    }
    else if (!bondSummary.isActive) {
        score -= 20;
        warnings.push("Bond account exists but is marked inactive.");
    }
    // Agent lifecycle Status: Active=0, Pending=1, Slashed=2, Deactivated=3.
    if (agent.status === 2) {
        score -= 15;
        warnings.push("Agent is flagged Slashed on chain.");
    }
    else if (agent.status === 1) {
        score -= 5;
        warnings.push("Agent is still Pending — not yet active.");
    }
    else if (agent.status === 3) {
        warnings.push("Agent is Deactivated; its bond tells you nothing new.");
    }
    // Every slash is a demonstrated failure. Ten points each, capped.
    score -= Math.min(sortedSlashes.length * 10, 40);
    // An unpaid slash is worse than a paid one: the harm is still outstanding.
    if (openSlashes > 0) {
        score -= Math.min(openSlashes * 12, 30);
        warnings.push(`${openSlashes} slash${openSlashes === 1 ? "" : "es"} recorded but not yet compensated — the victim is still owed.`);
    }
    // A sub-1-SOL bond is enough to register but thin against real risk.
    if (bondSummary && bondSummary.amountLamports < BigInt(LAMPORTS_PER_SOL)) {
        score -= 8;
        warnings.push("Bond is under 1 SOL — enough to register, thin for real counterparty risk.");
    }
    score = Math.max(0, Math.min(100, score));
    let grade;
    if (!hasStake) {
        grade = "ungraded";
    }
    else if (score >= 90)
        grade = "A";
    else if (score >= 75)
        grade = "B";
    else if (score >= 55)
        grade = "C";
    else if (score >= 30)
        grade = "D";
    else
        grade = "F";
    if (agent.trustScore !== score) {
        warnings.push(`On-chain trust_score is ${agent.trustScore}; the derived score is ${score}. These are different numbers by design — the on-chain value is admin-set and is not evidence.`);
    }
    return {
        address: agent.address.toBase58(),
        grade,
        score,
        onChainTrustScore: agent.trustScore,
        bond: bondSummary,
        slashes: slashSummaries,
        stats,
        warnings,
    };
}
//# sourceMappingURL=read.js.map