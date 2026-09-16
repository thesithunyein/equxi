import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { AccountFetcher, Located, TrustProfile } from "./read";
export * from "./read";
/** Maximum number of constraints the program allows per agent. */
export declare const MAX_CONSTRAINTS = 16;
export declare class EquxiClient {
    private program;
    private connection;
    private accounts;
    constructor(provider: AnchorProvider);
    /** Derive config PDA */
    findConfigPDA(): [PublicKey, number];
    /** Derive the escrow vault PDA */
    findVaultPDA(): [PublicKey, number];
    /** Derive this program's ProgramData PDA (needed by `initialize`) */
    findProgramDataPDA(): [PublicKey, number];
    /** Derive agent PDA */
    findAgentPDA(operator: PublicKey, name: string): [PublicKey, number];
    /** Derive bond PDA */
    findBondPDA(agentPDA: PublicKey): [PublicKey, number];
    /** Derive a constraint PDA from the agent's current constraint index */
    findConstraintPDA(agentPDA: PublicKey, index: number): [PublicKey, number];
    /**
     * Initialize the program. Must be signed by the program's upgrade authority,
     * which becomes the slash/compensation admin.
     */
    initialize(): Promise<{
        configPDA: anchor.web3.PublicKey;
        vaultPDA: anchor.web3.PublicKey;
        tx: string;
    }>;
    /** Register a new agent */
    registerAgent(name: string, agentType: any): Promise<{
        agentPDA: anchor.web3.PublicKey;
        tx: string;
    }>;
    /**
     * Create a bond. The agent's owner must sign and fund it — this is what stops
     * a third party from squatting an agent's bond PDA.
     */
    createBond(agentPDA: PublicKey, amount: BN, lockDuration: BN): Promise<{
        bondPDA: anchor.web3.PublicKey;
        tx: string;
    }>;
    /** Withdraw (and close) the bond after the lock expires */
    withdrawBond(agentPDA: PublicKey): Promise<{
        tx: string;
    }>;
    /** Add a constraint. Multiple constraints per agent are supported. */
    addConstraint(agentPDA: PublicKey, constraintType: any, params: any): Promise<{
        constraintPDA: anchor.web3.PublicKey;
        tx: string;
    }>;
    /** Execute slashing (admin only). Funds move into the escrow vault. */
    executeSlash(agentPDA: PublicKey, reason: string, slashAmount: BN): Promise<{
        slashPDA: anchor.web3.PublicKey;
        tx: string;
    }>;
    /** Pay a victim out of the escrow vault (admin only) */
    compensateVictim(agentPDA: PublicKey, slashNonce: BN, victim: PublicKey, amount: BN): Promise<{
        tx: string;
    }>;
    /** Fetch agent */
    getAgent(agentPDA: PublicKey): Promise<any>;
    /** Fetch bond */
    getBond(bondPDA: PublicKey): Promise<any>;
    /** Fetch config */
    getConfig(): Promise<any>;
    /** Fetch the escrow vault, including how much is available to victims */
    getVault(): Promise<any>;
    /** Public RPC connection this client queries. */
    getConnection(): Connection;
    /** This program's on-chain address. */
    getProgramId(): PublicKey;
    /**
     * Build a `Program`-free `AccountFetcher` backed by this client's connection.
     * Returning the interface (rather than fetching inline) is what lets the
     * read layer be unit tested against a fake.
     */
    getAccountFetcher(): AccountFetcher;
    /**
     * Account discriminators come from the IDL rather than being recomputed here.
     * `tests/unit/sdk.test.ts` pins the IDL's values to `sha256("account:" + Name)`,
     * so a stale IDL fails the suite instead of silently returning zero accounts.
     */
    private accountDiscriminator;
    /** Decoders backed by Anchor's own account coder, so layouts come from the IDL. */
    private get decoders();
    /** Every agent this program has registered. */
    listAgents(): Promise<Located<Record<string, unknown>>[]>;
    /** Every bond in existence. */
    listBonds(): Promise<Located<Record<string, unknown>>[]>;
    /** Slash history for one agent (or the whole program when `agent` is omitted). */
    listSlashRecords(agent?: PublicKey): Promise<Located<Record<string, unknown>>[]>;
    /** Constraints attached to one agent (or the whole program when omitted). */
    listConstraints(agent?: PublicKey): Promise<Located<Record<string, unknown>>[]>;
    /**
     * The public trust profile for one agent: bond, slash history, derived grade.
     * This is the single call a counterparty or a judge needs.
     */
    getTrustProfile(agentPDA: PublicKey, now?: number): Promise<TrustProfile>;
}
//# sourceMappingURL=index.d.ts.map