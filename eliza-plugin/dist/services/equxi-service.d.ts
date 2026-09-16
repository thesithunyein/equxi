/**
 * EquxiService — builds Equxi program transactions and reads its accounts.
 *
 * This service is deliberately **IDL-free**. Instructions are encoded directly
 * from the layouts in `coder.ts` (see the note at the top of that file for why).
 * The upside is that the plugin has no generated-artifact dependency at install
 * or runtime, so it keeps working from any context — an elizaOS runtime, a
 * server, or a test with no validator.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Service, type IAgentRuntime } from "@elizaos/core";
import { AgentType, ConstraintType, MAX_CONSTRAINTS, type AgentAccount, type BondAccount, type ConfigAccount, type ConstraintParamsInput, type SlashRecordAccount, type VaultAccount } from "../coder.js";
import type { TransactionInstruction } from "@solana/web3.js";
export { AgentType, ConstraintType, MAX_CONSTRAINTS };
export type { AgentAccount, BondAccount, ConfigAccount, SlashRecordAccount, VaultAccount, };
export declare class EquxiService extends Service {
    static serviceType: string;
    capabilityDescription: string;
    connection: Connection;
    programId: PublicKey;
    constructor(runtime?: IAgentRuntime);
    stop(): Promise<void>;
    /**
     * `register_agent(name, agent_type)`. The registering key becomes the agent's
     * owner, and only that owner may later bond it.
     */
    buildRegisterAgent(owner: PublicKey, name: string, agentType?: AgentType): Promise<TransactionInstruction>;
    /**
     * `create_bond(amount, lock_duration)`. The agent's **owner must sign** — this
     * is what prevents a third party from squatting the agent's only bond PDA.
     */
    buildLockBond(owner: PublicKey, agentName: string, amountLamports: bigint | number, lockDuration: bigint | number): Promise<TransactionInstruction>;
    /**
     * `withdraw_bond()`. Closes the bond and returns rent plus any un-slashed
     * collateral to the operator. Only valid once the lock has expired.
     */
    buildWithdrawBond(operator: PublicKey, agentName: string, agentOwner?: PublicKey): Promise<TransactionInstruction>;
    /**
     * `add_constraint(constraint_type, params)`. `constraintIndex` must be the
     * agent's current `constraint_count`; agents may hold up to 16 rules.
     */
    buildAddConstraint(owner: PublicKey, agentName: string, constraintIndex: number, constraintType: ConstraintType, params: ConstraintParamsInput): Promise<TransactionInstruction>;
    /**
     * `execute_slash(reason, slash_amount)`. Admin only. Moves collateral out of
     * the bond and **into the escrow vault** — never to the admin's wallet.
     */
    buildSlashBond(authority: PublicKey, agentOwner: PublicKey, agentName: string, slashAmount: bigint | number, reason: string): Promise<TransactionInstruction>;
    /**
     * `compensate_victim(amount)`. Admin only. Pays a victim **out of the vault**,
     * bounded by the amount actually seized in that slash.
     */
    buildCompensateVictim(authority: PublicKey, agentOwner: PublicKey, agentName: string, slashNonce: bigint | number, victim: PublicKey, amount: bigint | number): Promise<TransactionInstruction>;
    /** `update_trust_score(score)`. Admin only. */
    buildUpdateTrustScore(authority: PublicKey, agentOwner: PublicKey, agentName: string, score: number): Promise<TransactionInstruction>;
    /** Current slash counter, used as the `slash_record` PDA nonce seed. */
    getSlashNonce(): Promise<number>;
    private fetch;
    getConfig(): Promise<ConfigAccount | null>;
    getVault(): Promise<VaultAccount | null>;
    getAgent(owner: PublicKey, name: string): Promise<AgentAccount | null>;
    getBond(agentOwner: PublicKey, agentName: string): Promise<BondAccount | null>;
    getSlashRecord(agentOwner: PublicKey, agentName: string, nonce: bigint | number): Promise<SlashRecordAccount | null>;
}
export default EquxiService;
//# sourceMappingURL=equxi-service.d.ts.map