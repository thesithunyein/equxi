import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
export interface Agent {
    owner: PublicKey;
    name: string;
    agentType: AgentType;
    trustScore: number;
    status: AgentStatus;
    bondAddress: PublicKey;
    /** Number of constraints attached; also the next constraint PDA index. */
    constraintCount: number;
    createdAt: BN;
    bumped: number;
}
/**
 * Program-owned escrow holding slashed collateral until it is paid to a victim.
 * `totalSlashed - totalCompensated` is the amount available to compensate.
 */
export interface Vault {
    totalSlashed: BN;
    totalCompensated: BN;
    bumped: number;
}
export interface Bond {
    agent: PublicKey;
    operator: PublicKey;
    amount: BN;
    lockDuration: BN;
    lockedAt: BN;
    expiresAt: BN;
    isActive: boolean;
    bumped: number;
}
export interface Constraint {
    agent: PublicKey;
    constraintType: ConstraintType;
    params: ConstraintParams;
    isEnforced: boolean;
    createdAt: BN;
    bumped: number;
}
export interface SlashRecord {
    agent: PublicKey;
    authority: PublicKey;
    amount: BN;
    reason: string;
    timestamp: BN;
    victim: PublicKey | null;
    compensated: boolean;
}
export type AgentType = {
    trader: {};
} | {
    oracle: {};
} | {
    defi: {};
} | {
    payment: {};
} | {
    nft: {};
} | {
    governance: {};
} | {
    bridge: {};
} | {
    custom: {};
};
export type AgentStatus = {
    active: {};
} | {
    pending: {};
} | {
    slashed: {};
} | {
    deactivated: {};
};
export type ConstraintType = {
    spendLimit: {};
} | {
    programAllowlist: {};
} | {
    timelock: {};
} | {
    velocity: {};
} | {
    custom: {};
};
export interface ConstraintParams {
    maxAmount: BN;
    maxPerPeriod: BN;
    periodSeconds: BN;
    timelockSeconds: BN;
    allowedPrograms: PublicKey[];
}
//# sourceMappingURL=equxi.d.ts.map