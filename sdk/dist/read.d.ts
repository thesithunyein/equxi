/**
 * Equxi read layer — the queryable half of the protocol.
 *
 * The program's write path (bond, slash, compensate) is useless to a judge or a
 * counterparty unless they can *ask* one question: "does this agent have
 * collateral at risk, and has it ever been slashed?" That is what this module
 * answers.
 *
 * ## Why the account fetcher is injected
 *
 * Every function here takes an `AccountFetcher` instead of opening its own
 * connection. Two reasons:
 *
 *   1. `tests/unit/read.test.ts` passes a fake fetcher, so the filters, the
 *      decoding, and the aggregation are all exercised **without a validator**;
 *   2. the same code runs in the browser (`explorer.js`), in Node, and in a
 *      serverless function (`api/trust.js`) with no branching.
 *
 * Decoding is also injected (`decode`), so this file never duplicates the
 * account layouts — the caller passes `sdk/src/idl/equxi.json`-backed decoders or
 * the ones in `eliza-plugin/src/coder.ts`, and the unit tests cross-check that
 * they agree.
 */
import { PublicKey } from "@solana/web3.js";
/** Minimal structural view of `Connection.getProgramAccounts`. */
export interface RawAccount {
    pubkey: PublicKey;
    account: {
        data: Buffer;
        lamports: number;
        owner: PublicKey;
        executable: boolean;
        rentEpoch: number;
    };
}
export interface AccountFilter {
    memcmp: {
        offset: number;
        bytes: string;
    };
}
export interface FetcherConfig {
    filters: AccountFilter[];
    commitment?: "processed" | "confirmed" | "finalized";
}
export interface AccountFetcher {
    getProgramAccounts(programId: PublicKey, config: FetcherConfig): Promise<RawAccount[]>;
}
/** Anchor stores an 8-byte discriminator in front of every account. */
export interface Decoders<A, B, C, S> {
    agent: (data: Buffer) => A;
    bond: (data: Buffer) => B;
    constraint: (data: Buffer) => C;
    slashRecord: (data: Buffer) => S;
}
/** Result of decoding one account, paired with its on-chain address. */
export interface Located<T> {
    address: PublicKey;
    data: T;
}
/**
 * Anchor's account filters require the discriminator as a base58 string. Get
 * this wrong and `getProgramAccounts` silently returns an empty array for that
 * account type — which looks exactly like "no bonds exist" instead of "bug".
 */
export declare function discriminatorFilter(discriminator: Buffer, offset?: number): AccountFilter;
/** Filter by a pubkey stored inside the account (e.g. `bond.agent`). */
export declare function pubkeyFilter(pubkey: PublicKey, offset: number): AccountFilter;
export declare function bs58Encode(bytes: Uint8Array): string;
/** Every agent the program has ever registered. */
export declare function listAgents<A, B, C, S>(fetcher: AccountFetcher, programId: PublicKey, decoders: Decoders<A, B, C, S>, accountDiscriminators: {
    Agent: Buffer;
}): Promise<Located<A>[]>;
/** Every bond in existence. */
export declare function listBonds<A, B, C, S>(fetcher: AccountFetcher, programId: PublicKey, decoders: Decoders<A, B, C, S>, accountDiscriminators: {
    Bond: Buffer;
}): Promise<Located<B>[]>;
/** Slash history for one agent, oldest nonce first. */
export declare function listSlashRecords<A, B, C, S>(fetcher: AccountFetcher, programId: PublicKey, decoders: Decoders<A, B, C, S>, accountDiscriminators: {
    SlashRecord: Buffer;
}, agent?: PublicKey): Promise<Located<S>[]>;
/** Constraints attached to one agent. */
export declare function listConstraints<A, B, C, S>(fetcher: AccountFetcher, programId: PublicKey, decoders: Decoders<A, B, C, S>, accountDiscriminators: {
    Constraint: Buffer;
}, agent?: PublicKey): Promise<Located<C>[]>;
export interface BondSummary {
    address: string;
    amountLamports: bigint;
    amountSol: number;
    lockedAt: number;
    expiresAt: number;
    isActive: boolean;
    /** Lock period has elapsed; the operator may now withdraw. */
    expired: boolean;
    /** The bond is still inside its lock window. */
    locked: boolean;
}
export interface SlashSummary {
    address: string;
    nonce: bigint;
    amountLamports: bigint;
    amountSol: number;
    reason: string;
    timestamp: number;
    victim: string | null;
    compensated: boolean;
}
export interface TrustStats {
    slashCount: number;
    /** Slashes recorded but not yet paid to a victim. */
    openSlashes: number;
    totalSlashedLamports: bigint;
    compensationPaidLamports: bigint;
    /** Slashed but still sitting in escrow, owed to a victim. */
    uncompensatedLamports: bigint;
    slashRatePerMonth: number;
}
export type TrustGrade = "A" | "B" | "C" | "D" | "F" | "ungraded";
export interface TrustProfile {
    address: string;
    grade: TrustGrade;
    /** 0-100, derived *only* from observed bond + slash history. */
    score: number;
    /** The admin-set on-chain score. Reported separately — see `warnings`. */
    onChainTrustScore: number;
    bond: BondSummary | null;
    slashes: SlashSummary[];
    stats: TrustStats;
    warnings: string[];
}
export declare function lamportsToSol(lamports: bigint): number;
export interface TrustProfileInput {
    agent: {
        address: PublicKey;
        owner: PublicKey;
        name: string;
        trustScore: number;
        status: number;
    };
    bond: {
        address: PublicKey;
        amount: bigint;
        lockedAt: number;
        expiresAt: number;
        isActive: boolean;
    } | null;
    slashes: Array<{
        address: PublicKey;
        amount: bigint;
        reason: string;
        timestamp: number;
        victim: string | null;
        compensated: boolean;
        nonce: bigint;
    }>;
    /** Unix seconds. Injected so the output is deterministic under test. */
    now: number;
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
export declare function buildTrustProfile(input: TrustProfileInput): TrustProfile;
//# sourceMappingURL=read.d.ts.map