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
/** Equxi program id. Update for mainnet. */
export declare const EQUXI_PROGRAM_ID: PublicKey;
/** Default RPC endpoint. */
export declare const SOLANA_RPC = "https://api.devnet.solana.com";
export declare enum AgentType {
    Trader = 0,
    Oracle = 1,
    DeFi = 2,
    Payment = 3,
    NFT = 4,
    Governance = 5,
    Bridge = 6,
    Custom = 7
}
export declare enum AgentStatus {
    Active = 0,
    Pending = 1,
    Slashed = 2,
    Deactivated = 3
}
export declare enum ConstraintType {
    SpendLimit = 0,
    ProgramAllowlist = 1,
    Timelock = 2,
    Velocity = 3,
    Custom = 4
}
/** Number of pubkeys in `ConstraintParams.allowed_programs`. */
export declare const ALLOWED_PROGRAMS_LEN = 8;
/** Maximum rules per agent, enforced on-chain by `MAX_CONSTRAINTS`. */
export declare const MAX_CONSTRAINTS = 16;
/** Anchor instruction discriminator: `sha256("global:" + name)[0..8]`. */
export declare function ixDiscriminator(name: string): Buffer;
/** Anchor account discriminator: `sha256("account:" + Name)[0..8]`. */
export declare function accountDiscriminator(name: string): Buffer;
export declare function u8(n: number): Buffer;
export declare function u16le(n: number): Buffer;
export declare function u32le(n: number): Buffer;
export declare function u64le(n: bigint | number): Buffer;
export declare function i64le(n: bigint | number): Buffer;
/** Borsh `String`: u32 little-endian byte length followed by UTF-8 bytes. */
export declare function borshString(s: string): Buffer;
export declare function pubkeyBytes(p: PublicKey): Buffer;
export declare function findConfigPDA(): PublicKey;
export declare function findVaultPDA(): PublicKey;
/** `["agent", owner, name]` */
export declare function findAgentPDA(owner: PublicKey, name: string): PublicKey;
/** `["bond", agent]` — one bond per agent. */
export declare function findBondPDA(agent: PublicKey): PublicKey;
/**
 * `["constraint", agent, index]` where `index` is the agent's own
 * `constraint_count` as a little-endian `u16` — not a global counter.
 */
export declare function findConstraintPDA(agent: PublicKey, index: number): PublicKey;
/** `["slash", agent, nonce]` where `nonce` is `config.total_slashed`. */
export declare function findSlashRecordPDA(agent: PublicKey, nonce: bigint | number): PublicKey;
/** `register_agent(name: String, agent_type: AgentType)` */
export declare function registerAgentData(name: string, agentType: AgentType): Buffer;
/** `create_bond(amount: u64, lock_duration: i64)` */
export declare function createBondData(amount: bigint | number, lockDuration: bigint | number): Buffer;
/** `withdraw_bond()` */
export declare function withdrawBondData(): Buffer;
export interface ConstraintParamsInput {
    maxAmount: bigint | number;
    maxPerPeriod: bigint | number;
    periodSeconds: bigint | number;
    timelockSeconds: bigint | number;
    allowedPrograms: PublicKey[];
}
/**
 * Fixed-size `ConstraintParams` = 288 bytes: u64 + u64 + i64 + i64 + [Pubkey; 8]
 * (32 + 8 x 32). It is fixed-size on purpose so the account length is stable.
 */
export declare function encodeConstraintParams(params: ConstraintParamsInput): Buffer;
/** `add_constraint(constraint_type: ConstraintType, params: ConstraintParams)` */
export declare function addConstraintData(constraintType: ConstraintType, params: ConstraintParamsInput): Buffer;
/** `execute_slash(reason: String, slash_amount: u64)` */
export declare function executeSlashData(reason: string, slashAmount: bigint | number): Buffer;
/** `compensate_victim(amount: u64)` */
export declare function compensateVictimData(amount: bigint | number): Buffer;
/** `update_trust_score(score: u8)` */
export declare function updateTrustScoreData(score: number): Buffer;
/** `initialize()` */
export declare function initializeData(): Buffer;
export interface ConfigAccount {
    admin: string;
    totalAgents: number;
    totalBonds: number;
    /** Slash counter — the seed for `slash_record` PDAs, NOT a lamport amount. */
    totalSlashes: number;
    bumped: number;
}
export interface VaultAccount {
    /** Cumulative lamports moved into escrow by `execute_slash`. */
    totalSlashed: bigint;
    /** Cumulative lamports paid out by `compensate_victim`. */
    totalCompensated: bigint;
    /** Lamports currently available to compensate victims. */
    available: bigint;
    bumped: number;
}
export interface AgentAccount {
    owner: string;
    name: string;
    agentType: AgentType;
    trustScore: number;
    status: AgentStatus;
    bondAddress: string;
    constraintCount: number;
    createdAt: number;
    bumped: number;
}
export interface BondAccount {
    agent: string;
    operator: string;
    amount: bigint;
    lockDuration: number;
    lockedAt: number;
    expiresAt: number;
    isActive: boolean;
    bumped: number;
}
export interface ConstraintAccount {
    agent: string;
    constraintType: ConstraintType;
    params: ConstraintParamsInput;
    isEnforced: boolean;
    createdAt: number;
    bumped: number;
}
export interface SlashRecordAccount {
    agent: string;
    authority: string;
    amount: bigint;
    reason: string;
    nonce: bigint;
    timestamp: number;
    victim: string | null;
    compensated: boolean;
    bumped: number;
}
/** Trim the fixed-width `[u8; 32]` name at the first NUL. */
export declare function decodeName(data: Buffer, offset?: number): string;
/**
 * `Config`: disc(8) + admin(32) + total_agents(8) + total_bonds(8)
 *           + total_slashed(8) + bumped(1) = 65 bytes
 */
export declare function decodeConfig(data: Buffer): ConfigAccount;
/**
 * `Vault`: disc(8) + total_slashed(8) + total_compensated(8) + bumped(1)
 */
export declare function decodeVault(data: Buffer): VaultAccount;
/**
 * `Agent`: disc(8) + owner(32) + name(32) + agent_type(1) + trust_score(1)
 *          + status(1) + bond_address(32) + constraint_count(2)
 *          + created_at(8) + bumped(1) = 118 bytes
 */
export declare function decodeAgent(data: Buffer): AgentAccount;
/**
 * `Bond`: disc(8) + agent(32) + operator(32) + amount(8) + lock_duration(8)
 *         + locked_at(8) + expires_at(8) + is_active(1) + bumped(1) = 106 bytes
 */
export declare function decodeBond(data: Buffer): BondAccount;
/**
 * `Constraint`: disc(8) + agent(32) + constraint_type(1) + params(288)
 *               + is_enforced(1) + created_at(8) + bumped(1) = 339 bytes
 */
export declare function decodeConstraint(data: Buffer): ConstraintAccount;
/**
 * `SlashRecord`: disc(8) + agent(32) + authority(32) + amount(8) + reason(128)
 *                + nonce(8) + timestamp(8) + victim(1 + 32, Option) + compensated(1)
 *                + bumped(1) = 259 bytes
 */
export declare function decodeSlashRecord(data: Buffer): SlashRecordAccount;
export declare const ACCOUNT_DISCRIMINATORS: {
    readonly Config: Buffer;
    readonly Vault: Buffer;
    readonly Agent: Buffer;
    readonly Bond: Buffer;
    readonly Constraint: Buffer;
    readonly SlashRecord: Buffer;
};
//# sourceMappingURL=coder.d.ts.map