/**
 * EquxiService — builds Equxi program transactions and reads its accounts.
 *
 * This service is deliberately **IDL-free**. Instructions are encoded directly
 * from the layouts in `coder.ts` (see the note at the top of that file for why).
 * The upside is that the plugin has no generated-artifact dependency at install
 * or runtime, so it keeps working from any context — an elizaOS runtime, a
 * server, or a test with no validator.
 */
import { Connection, SystemProgram } from "@solana/web3.js";
import { Service } from "@elizaos/core";
import { AgentType, ConstraintType, EQUXI_PROGRAM_ID, MAX_CONSTRAINTS, SOLANA_RPC, addConstraintData, compensateVictimData, createBondData, decodeAgent, decodeBond, decodeConfig, decodeSlashRecord, decodeVault, executeSlashData, findAgentPDA, findBondPDA, findConfigPDA, findConstraintPDA, findSlashRecordPDA, findVaultPDA, registerAgentData, updateTrustScoreData, withdrawBondData, } from "../coder.js";
export { AgentType, ConstraintType, MAX_CONSTRAINTS };
function ix(name, data, keys) {
    return {
        programId: EQUXI_PROGRAM_ID,
        keys,
        data: data,
        ...{ __equxiInstruction: name },
    };
}
const sys = () => ({
    pubkey: SystemProgram.programId,
    isSigner: false,
    isWritable: false,
});
export class EquxiService extends Service {
    static serviceType = "equxi";
    capabilityDescription = "Equxi: bond, guardrail, and slash AI agents on Solana. Builds accountability transactions and reads on-chain bond and trust state.";
    connection;
    programId = EQUXI_PROGRAM_ID;
    constructor(runtime) {
        super(runtime);
        const configured = runtime?.getSetting("SOLANA_RPC_URL");
        const rpcUrl = typeof configured === "string" && configured.length > 0
            ? configured
            : SOLANA_RPC;
        this.connection = new Connection(rpcUrl, "confirmed");
    }
    async stop() {
        // Nothing to tear down: this service holds no sockets or subscriptions.
    }
    /* ── Instruction builders ──────────────────────────────────────────── */
    /**
     * `register_agent(name, agent_type)`. The registering key becomes the agent's
     * owner, and only that owner may later bond it.
     */
    async buildRegisterAgent(owner, name, agentType = AgentType.Trader) {
        return ix("register_agent", registerAgentData(name, agentType), [
            { pubkey: findConfigPDA(), isSigner: false, isWritable: true },
            { pubkey: findAgentPDA(owner, name), isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: true },
            sys(),
        ]);
    }
    /**
     * `create_bond(amount, lock_duration)`. The agent's **owner must sign** — this
     * is what prevents a third party from squatting the agent's only bond PDA.
     */
    async buildLockBond(owner, agentName, amountLamports, lockDuration) {
        const agentPDA = findAgentPDA(owner, agentName);
        return ix("create_bond", createBondData(amountLamports, lockDuration), [
            { pubkey: findConfigPDA(), isSigner: false, isWritable: true },
            { pubkey: findBondPDA(agentPDA), isSigner: false, isWritable: true },
            { pubkey: agentPDA, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: true },
            sys(),
        ]);
    }
    /**
     * `withdraw_bond()`. Closes the bond and returns rent plus any un-slashed
     * collateral to the operator. Only valid once the lock has expired.
     */
    async buildWithdrawBond(operator, agentName, agentOwner) {
        const owner = agentOwner ?? operator;
        const agentPDA = findAgentPDA(owner, agentName);
        return ix("withdraw_bond", withdrawBondData(), [
            { pubkey: findBondPDA(agentPDA), isSigner: false, isWritable: true },
            { pubkey: agentPDA, isSigner: false, isWritable: true },
            { pubkey: operator, isSigner: true, isWritable: true },
        ]);
    }
    /**
     * `add_constraint(constraint_type, params)`. `constraintIndex` must be the
     * agent's current `constraint_count`; agents may hold up to 16 rules.
     */
    async buildAddConstraint(owner, agentName, constraintIndex, constraintType, params) {
        const agentPDA = findAgentPDA(owner, agentName);
        return ix("add_constraint", addConstraintData(constraintType, params), [
            {
                pubkey: findConstraintPDA(agentPDA, constraintIndex),
                isSigner: false,
                isWritable: true,
            },
            { pubkey: agentPDA, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: true },
            sys(),
        ]);
    }
    /**
     * `execute_slash(reason, slash_amount)`. Admin only. Moves collateral out of
     * the bond and **into the escrow vault** — never to the admin's wallet.
     */
    async buildSlashBond(authority, agentOwner, agentName, slashAmount, reason) {
        const agentPDA = findAgentPDA(agentOwner, agentName);
        const nonce = await this.getSlashNonce();
        return ix("execute_slash", executeSlashData(reason, slashAmount), [
            { pubkey: findConfigPDA(), isSigner: false, isWritable: true },
            { pubkey: findVaultPDA(), isSigner: false, isWritable: true },
            { pubkey: agentPDA, isSigner: false, isWritable: true },
            { pubkey: findBondPDA(agentPDA), isSigner: false, isWritable: true },
            {
                pubkey: findSlashRecordPDA(agentPDA, nonce),
                isSigner: false,
                isWritable: true,
            },
            { pubkey: authority, isSigner: true, isWritable: true },
            sys(),
        ]);
    }
    /**
     * `compensate_victim(amount)`. Admin only. Pays a victim **out of the vault**,
     * bounded by the amount actually seized in that slash.
     */
    async buildCompensateVictim(authority, agentOwner, agentName, slashNonce, victim, amount) {
        const agentPDA = findAgentPDA(agentOwner, agentName);
        return ix("compensate_victim", compensateVictimData(amount), [
            { pubkey: findConfigPDA(), isSigner: false, isWritable: false },
            { pubkey: findVaultPDA(), isSigner: false, isWritable: true },
            {
                pubkey: findSlashRecordPDA(agentPDA, slashNonce),
                isSigner: false,
                isWritable: true,
            },
            { pubkey: agentPDA, isSigner: false, isWritable: true },
            { pubkey: victim, isSigner: false, isWritable: true },
            { pubkey: authority, isSigner: true, isWritable: false },
        ]);
    }
    /** `update_trust_score(score)`. Admin only. */
    async buildUpdateTrustScore(authority, agentOwner, agentName, score) {
        return ix("update_trust_score", updateTrustScoreData(score), [
            { pubkey: findConfigPDA(), isSigner: false, isWritable: false },
            {
                pubkey: findAgentPDA(agentOwner, agentName),
                isSigner: false,
                isWritable: true,
            },
            { pubkey: authority, isSigner: true, isWritable: false },
        ]);
    }
    /* ── Read helpers ──────────────────────────────────────────────────── */
    /** Current slash counter, used as the `slash_record` PDA nonce seed. */
    async getSlashNonce() {
        const config = await this.getConfig();
        return config ? config.totalSlashes : 0;
    }
    async fetch(address, decode) {
        const info = await this.connection.getAccountInfo(address);
        if (!info)
            return null;
        try {
            return decode(Buffer.from(info.data));
        }
        catch {
            // Account exists but is not the shape we expect (e.g. a stale deployment).
            return null;
        }
    }
    getConfig() {
        return this.fetch(findConfigPDA(), decodeConfig);
    }
    getVault() {
        return this.fetch(findVaultPDA(), decodeVault);
    }
    getAgent(owner, name) {
        return this.fetch(findAgentPDA(owner, name), decodeAgent);
    }
    getBond(agentOwner, agentName) {
        return this.fetch(findBondPDA(findAgentPDA(agentOwner, agentName)), decodeBond);
    }
    getSlashRecord(agentOwner, agentName, nonce) {
        return this.fetch(findSlashRecordPDA(findAgentPDA(agentOwner, agentName), nonce), decodeSlashRecord);
    }
}
export default EquxiService;
//# sourceMappingURL=equxi-service.js.map