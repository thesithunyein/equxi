/**
 * Borsh / Anchor wire-format helpers for the Equxi program.
 *
 * ## Why this file exists (and why there is no IDL)
 *
 * The first version of this plugin embedded a hand-written copy of the Anchor
 * IDL. That copy silently drifted from the on-chain program: it still described
 * a retired `operator` account on `create_bond`, a `config` account on
 * `add_constraint` that the program does not take, and an `execute_slash` that
 * did not yet route funds through the escrow vault. Because the IDL was only
 * ever *read* at runtime, nothing caught the drift — the plugin simply built
 * transactions the program rejected.
 *
 * Anything that is duplicated by hand drifts. So instead of duplicating the IDL,
 * this module derives everything from first principles:
 *
 *   - instruction discriminators are `sha256("global:<snake_case_name>")[0..8]`,
 *     exactly as Anchor's `#[program]` macro emits them;
 *   - account discriminators are `sha256("account:<PascalCaseName>")[0..8]`;
 *   - arguments are Borsh-encoded in declaration order.
 *
 * The layouts implemented here are the contract documented in `SPEC.md`, and
 * they are locked down by the unit tests in `tests/unit/layout.test.ts`, which
 * run without a validator.
 */
import { PublicKey } from "@solana/web3.js";
// Note: imported without the `node:` prefix so this compiles against the older
// @types/node versions that other packages pull in transitively.
import { createHash } from "crypto";
/**
 * SHA-256 of a UTF-8 string, as bytes.
 *
 * Do **not** reach for `anchor.utils.sha256.hash()` here. Its implementation is
 * `new TextDecoder().decode(sha256(data))` — it decodes a raw 32-byte digest as
 * UTF-8, which is lossy for arbitrary digests. Round-tripping that string back
 * to bytes yields the wrong length and wrong bytes, so using it silently
 * produced *empty* discriminators and transactions the program rejected.
 */
function sha256Bytes(input) {
    return createHash("sha256").update(input, "utf8").digest();
}
/** Equxi program id. Update for mainnet. */
export const EQUXI_PROGRAM_ID = new PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");
/** Default RPC endpoint. */
export const SOLANA_RPC = "https://api.devnet.solana.com";
/* ── Enums (values must match `programs/equxi/src/state.rs`) ───────────── */
export var AgentType;
(function (AgentType) {
    AgentType[AgentType["Trader"] = 0] = "Trader";
    AgentType[AgentType["Oracle"] = 1] = "Oracle";
    AgentType[AgentType["DeFi"] = 2] = "DeFi";
    AgentType[AgentType["Payment"] = 3] = "Payment";
    AgentType[AgentType["NFT"] = 4] = "NFT";
    AgentType[AgentType["Governance"] = 5] = "Governance";
    AgentType[AgentType["Bridge"] = 6] = "Bridge";
    AgentType[AgentType["Custom"] = 7] = "Custom";
})(AgentType || (AgentType = {}));
export var AgentStatus;
(function (AgentStatus) {
    AgentStatus[AgentStatus["Active"] = 0] = "Active";
    AgentStatus[AgentStatus["Pending"] = 1] = "Pending";
    AgentStatus[AgentStatus["Slashed"] = 2] = "Slashed";
    AgentStatus[AgentStatus["Deactivated"] = 3] = "Deactivated";
})(AgentStatus || (AgentStatus = {}));
export var ConstraintType;
(function (ConstraintType) {
    ConstraintType[ConstraintType["SpendLimit"] = 0] = "SpendLimit";
    ConstraintType[ConstraintType["ProgramAllowlist"] = 1] = "ProgramAllowlist";
    ConstraintType[ConstraintType["Timelock"] = 2] = "Timelock";
    ConstraintType[ConstraintType["Velocity"] = 3] = "Velocity";
    ConstraintType[ConstraintType["Custom"] = 4] = "Custom";
})(ConstraintType || (ConstraintType = {}));
/** Number of pubkeys in `ConstraintParams.allowed_programs`. */
export const ALLOWED_PROGRAMS_LEN = 8;
/** Maximum rules per agent, enforced on-chain by `MAX_CONSTRAINTS`. */
export const MAX_CONSTRAINTS = 16;
/* ── Discriminators ────────────────────────────────────────────────────── */
/** Anchor instruction discriminator: `sha256("global:" + name)[0..8]`. */
export function ixDiscriminator(name) {
    return sha256Bytes(`global:${name}`).subarray(0, 8);
}
/** Anchor account discriminator: `sha256("account:" + Name)[0..8]`. */
export function accountDiscriminator(name) {
    return sha256Bytes(`account:${name}`).subarray(0, 8);
}
/* ── Borsh primitives ──────────────────────────────────────────────────── */
export function u8(n) {
    return Buffer.from([n & 0xff]);
}
export function u16le(n) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n, 0);
    return b;
}
export function u32le(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
}
export function u64le(n) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n), 0);
    return b;
}
export function i64le(n) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(n), 0);
    return b;
}
/** Borsh `String`: u32 little-endian byte length followed by UTF-8 bytes. */
export function borshString(s) {
    const body = Buffer.from(s, "utf8");
    return Buffer.concat([u32le(body.length), body]);
}
export function pubkeyBytes(p) {
    return p.toBuffer();
}
/* ── PDAs (seeds must match the `#[account(seeds = [...])]` constraints) ─ */
export function findConfigPDA() {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], EQUXI_PROGRAM_ID)[0];
}
export function findVaultPDA() {
    return PublicKey.findProgramAddressSync([Buffer.from("vault")], EQUXI_PROGRAM_ID)[0];
}
/** `["agent", owner, name]` */
export function findAgentPDA(owner, name) {
    return PublicKey.findProgramAddressSync([Buffer.from("agent"), owner.toBuffer(), Buffer.from(name, "utf8")], EQUXI_PROGRAM_ID)[0];
}
/** `["bond", agent]` — one bond per agent. */
export function findBondPDA(agent) {
    return PublicKey.findProgramAddressSync([Buffer.from("bond"), agent.toBuffer()], EQUXI_PROGRAM_ID)[0];
}
/**
 * `["constraint", agent, index]` where `index` is the agent's own
 * `constraint_count` as a little-endian `u16` — not a global counter.
 */
export function findConstraintPDA(agent, index) {
    return PublicKey.findProgramAddressSync([Buffer.from("constraint"), agent.toBuffer(), u16le(index)], EQUXI_PROGRAM_ID)[0];
}
/** `["slash", agent, nonce]` where `nonce` is `config.total_slashed`. */
export function findSlashRecordPDA(agent, nonce) {
    return PublicKey.findProgramAddressSync([Buffer.from("slash"), agent.toBuffer(), u64le(nonce)], EQUXI_PROGRAM_ID)[0];
}
/* ── Instruction data ──────────────────────────────────────────────────── */
/** `register_agent(name: String, agent_type: AgentType)` */
export function registerAgentData(name, agentType) {
    return Buffer.concat([ixDiscriminator("register_agent"), borshString(name), u8(agentType)]);
}
/** `create_bond(amount: u64, lock_duration: i64)` */
export function createBondData(amount, lockDuration) {
    return Buffer.concat([
        ixDiscriminator("create_bond"),
        u64le(amount),
        i64le(lockDuration),
    ]);
}
/** `withdraw_bond()` */
export function withdrawBondData() {
    return ixDiscriminator("withdraw_bond");
}
/**
 * Fixed-size `ConstraintParams` = 288 bytes: u64 + u64 + i64 + i64 + [Pubkey; 8]
 * (32 + 8 x 32). It is fixed-size on purpose so the account length is stable.
 */
export function encodeConstraintParams(params) {
    const programs = params.allowedPrograms.slice(0, ALLOWED_PROGRAMS_LEN);
    while (programs.length < ALLOWED_PROGRAMS_LEN) {
        programs.push(PublicKey.default);
    }
    return Buffer.concat([
        u64le(params.maxAmount),
        u64le(params.maxPerPeriod),
        i64le(params.periodSeconds),
        i64le(params.timelockSeconds),
        ...programs.map(pubkeyBytes),
    ]);
}
/** `add_constraint(constraint_type: ConstraintType, params: ConstraintParams)` */
export function addConstraintData(constraintType, params) {
    return Buffer.concat([
        ixDiscriminator("add_constraint"),
        u8(constraintType),
        encodeConstraintParams(params),
    ]);
}
/** `execute_slash(reason: String, slash_amount: u64)` */
export function executeSlashData(reason, slashAmount) {
    return Buffer.concat([
        ixDiscriminator("execute_slash"),
        borshString(reason),
        u64le(slashAmount),
    ]);
}
/** `compensate_victim(amount: u64)` */
export function compensateVictimData(amount) {
    return Buffer.concat([ixDiscriminator("compensate_victim"), u64le(amount)]);
}
/** `update_trust_score(score: u8)` */
export function updateTrustScoreData(score) {
    return Buffer.concat([ixDiscriminator("update_trust_score"), u8(score)]);
}
/** `initialize()` */
export function initializeData() {
    return ixDiscriminator("initialize");
}
function assertLength(data, min, what) {
    if (data.length < min) {
        throw new Error(`${what} account is ${data.length} bytes; expected at least ${min}`);
    }
}
function readPubkey(data, offset) {
    return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}
/** Trim the fixed-width `[u8; 32]` name at the first NUL. */
export function decodeName(data, offset = 40) {
    const raw = data.subarray(offset, offset + 32);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}
/**
 * `Config`: disc(8) + admin(32) + total_agents(8) + total_bonds(8)
 *           + total_slashed(8) + bumped(1) = 65 bytes
 */
export function decodeConfig(data) {
    assertLength(data, 65, "Config");
    return {
        admin: readPubkey(data, 8),
        totalAgents: Number(data.readBigUInt64LE(40)),
        totalBonds: Number(data.readBigUInt64LE(48)),
        totalSlashes: Number(data.readBigUInt64LE(56)),
        bumped: data[64],
    };
}
/**
 * `Vault`: disc(8) + total_slashed(8) + total_compensated(8) + bumped(1)
 */
export function decodeVault(data) {
    assertLength(data, 25, "Vault");
    const totalSlashed = data.readBigUInt64LE(8);
    const totalCompensated = data.readBigUInt64LE(16);
    return {
        totalSlashed,
        totalCompensated,
        available: totalSlashed > totalCompensated ? totalSlashed - totalCompensated : 0n,
        bumped: data[24],
    };
}
/**
 * `Agent`: disc(8) + owner(32) + name(32) + agent_type(1) + trust_score(1)
 *          + status(1) + bond_address(32) + constraint_count(2)
 *          + created_at(8) + bumped(1) = 118 bytes
 */
export function decodeAgent(data) {
    assertLength(data, 118, "Agent");
    return {
        owner: readPubkey(data, 8),
        name: decodeName(data, 40),
        agentType: data[72],
        trustScore: data[73],
        status: data[74],
        bondAddress: readPubkey(data, 75),
        constraintCount: data.readUInt16LE(107),
        createdAt: Number(data.readBigInt64LE(109)),
        bumped: data[117],
    };
}
/**
 * `Bond`: disc(8) + agent(32) + operator(32) + amount(8) + lock_duration(8)
 *         + locked_at(8) + expires_at(8) + is_active(1) + bumped(1) = 106 bytes
 */
export function decodeBond(data) {
    assertLength(data, 106, "Bond");
    return {
        agent: readPubkey(data, 8),
        operator: readPubkey(data, 40),
        amount: data.readBigUInt64LE(72),
        lockDuration: Number(data.readBigInt64LE(80)),
        lockedAt: Number(data.readBigInt64LE(88)),
        expiresAt: Number(data.readBigInt64LE(96)),
        isActive: data[104] === 1,
        bumped: data[105],
    };
}
/**
 * `Constraint`: disc(8) + agent(32) + constraint_type(1) + params(288)
 *               + is_enforced(1) + created_at(8) + bumped(1) = 339 bytes
 */
export function decodeConstraint(data) {
    assertLength(data, 339, "Constraint");
    return {
        agent: readPubkey(data, 8),
        constraintType: data[40],
        params: {
            maxAmount: data.readBigUInt64LE(41),
            maxPerPeriod: data.readBigUInt64LE(49),
            periodSeconds: Number(data.readBigInt64LE(57)),
            timelockSeconds: Number(data.readBigInt64LE(65)),
            allowedPrograms: Array.from({ length: ALLOWED_PROGRAMS_LEN }, (_, i) => new PublicKey(data.subarray(73 + i * 32, 73 + (i + 1) * 32))),
        },
        isEnforced: data[329] === 1,
        createdAt: Number(data.readBigInt64LE(330)),
        bumped: data[338],
    };
}
/**
 * `SlashRecord`: disc(8) + agent(32) + authority(32) + amount(8) + reason(128)
 *                + nonce(8) + timestamp(8) + victim(1 + 32, Option) + compensated(1)
 *                + bumped(1) = 259 bytes
 */
export function decodeSlashRecord(data) {
    assertLength(data, 259, "SlashRecord");
    const victimTag = data[224];
    const rawReason = data.subarray(80, 208);
    const reasonEnd = rawReason.indexOf(0);
    return {
        agent: readPubkey(data, 8),
        authority: readPubkey(data, 40),
        amount: data.readBigUInt64LE(72),
        reason: rawReason
            .subarray(0, reasonEnd === -1 ? rawReason.length : reasonEnd)
            .toString("utf8"),
        nonce: data.readBigUInt64LE(208),
        timestamp: Number(data.readBigInt64LE(216)),
        victim: victimTag === 1 ? readPubkey(data, 225) : null,
        compensated: data[257] === 1,
        bumped: data[258],
    };
}
export const ACCOUNT_DISCRIMINATORS = {
    Config: accountDiscriminator("Config"),
    Vault: accountDiscriminator("Vault"),
    Agent: accountDiscriminator("Agent"),
    Bond: accountDiscriminator("Bond"),
    Constraint: accountDiscriminator("Constraint"),
    SlashRecord: accountDiscriminator("SlashRecord"),
};
//# sourceMappingURL=coder.js.map