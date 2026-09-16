"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquxiClient = exports.MAX_CONSTRAINTS = void 0;
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_1 = require("@solana/web3.js");
const read_1 = require("./read");
__exportStar(require("./read"), exports);
const PROGRAM_ID = new web3_js_1.PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");
const BPF_LOADER_UPGRADEABLE = new web3_js_1.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** Maximum number of constraints the program allows per agent. */
exports.MAX_CONSTRAINTS = 16;
/**
 * The IDL is a standalone, reviewable artifact in `./idl/equxi.json`.
 *
 * It was previously inlined here in the Anchor <= 0.29 shape, which silently
 * made every `new EquxiClient(provider)` throw against Anchor 0.30. Three
 * separate breaking changes were involved:
 *
 *   1. `address` is now required on the IDL — the program id used to be passed
 *      to `new Program(idl, programId, provider)`, but 0.30 reads `idl.address`.
 *   2. the `publicKey` type string was renamed to `pubkey`;
 *   3. `{ defined: "Name" }` became `{ defined: { name: "Name" } }`, and account
 *      structs moved out of `accounts` into `types` (accounts now carry only a
 *      `discriminator`).
 *
 * `anchor build` regenerates an equivalent file at `target/idl/equxi.json`;
 * copying that over `./idl/equxi.json` is the supported way to refresh this.
 * `tests/unit/sdk.test.ts` constructs a client from this file and decodes real
 * account bytes with it, so a bad IDL fails the test suite rather than a user.
 */
const equxi_json_1 = __importDefault(require("./idl/equxi.json"));
const IDL = equxi_json_1.default;
class EquxiClient {
    constructor(provider) {
        this.program = new anchor_1.Program(IDL, provider);
        this.connection = provider.connection;
        this.accounts = this.program.account;
    }
    /** Derive config PDA */
    findConfigPDA() {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("config")], this.program.programId);
    }
    /** Derive the escrow vault PDA */
    findVaultPDA() {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault")], this.program.programId);
    }
    /** Derive this program's ProgramData PDA (needed by `initialize`) */
    findProgramDataPDA() {
        return web3_js_1.PublicKey.findProgramAddressSync([this.program.programId.toBuffer()], BPF_LOADER_UPGRADEABLE);
    }
    /** Derive agent PDA */
    findAgentPDA(operator, name) {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)], this.program.programId);
    }
    /** Derive bond PDA */
    findBondPDA(agentPDA) {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("bond"), agentPDA.toBuffer()], this.program.programId);
    }
    /** Derive a constraint PDA from the agent's current constraint index */
    findConstraintPDA(agentPDA, index) {
        const idx = Buffer.alloc(2);
        idx.writeUInt16LE(index, 0);
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("constraint"), agentPDA.toBuffer(), idx], this.program.programId);
    }
    /**
     * Initialize the program. Must be signed by the program's upgrade authority,
     * which becomes the slash/compensation admin.
     */
    async initialize() {
        const payer = this.program.provider.publicKey;
        const [configPDA] = this.findConfigPDA();
        const [vaultPDA] = this.findVaultPDA();
        const [programDataPDA] = this.findProgramDataPDA();
        const tx = await this.program.methods
            .initialize()
            .accounts({
            config: configPDA,
            vault: vaultPDA,
            payer,
            program: this.program.programId,
            programData: programDataPDA,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return { configPDA, vaultPDA, tx };
    }
    /** Register a new agent */
    async registerAgent(name, agentType) {
        const operator = this.program.provider.publicKey;
        const [configPDA] = this.findConfigPDA();
        const [agentPDA] = this.findAgentPDA(operator, name);
        const tx = await this.program.methods
            .registerAgent(name, agentType)
            .accounts({
            config: configPDA,
            agent: agentPDA,
            operator,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return { agentPDA, tx };
    }
    /**
     * Create a bond. The agent's owner must sign and fund it — this is what stops
     * a third party from squatting an agent's bond PDA.
     */
    async createBond(agentPDA, amount, lockDuration) {
        const owner = this.program.provider.publicKey;
        const agent = await this.accounts.agent.fetch(agentPDA);
        if (agent.owner.toString() !== owner.toString()) {
            throw new Error(`Only the agent owner (${agent.owner.toString()}) can create this bond`);
        }
        const [configPDA] = this.findConfigPDA();
        const [bondPDA] = this.findBondPDA(agentPDA);
        const tx = await this.program.methods
            .createBond(amount, lockDuration)
            .accounts({
            config: configPDA,
            bond: bondPDA,
            agent: agentPDA,
            owner,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return { bondPDA, tx };
    }
    /** Withdraw (and close) the bond after the lock expires */
    async withdrawBond(agentPDA) {
        const operator = this.program.provider.publicKey;
        const [bondPDA] = this.findBondPDA(agentPDA);
        const tx = await this.program.methods
            .withdrawBond()
            .accounts({
            bond: bondPDA,
            agent: agentPDA,
            operator,
        })
            .rpc();
        return { tx };
    }
    /** Add a constraint. Multiple constraints per agent are supported. */
    async addConstraint(agentPDA, constraintType, params) {
        const owner = this.program.provider.publicKey;
        const agent = await this.accounts.agent.fetch(agentPDA);
        if (agent.constraintCount >= exports.MAX_CONSTRAINTS) {
            throw new Error(`Agent already has the maximum ${exports.MAX_CONSTRAINTS} constraints`);
        }
        const [constraintPDA] = this.findConstraintPDA(agentPDA, agent.constraintCount);
        const tx = await this.program.methods
            .addConstraint(constraintType, params)
            .accounts({
            constraint: constraintPDA,
            agent: agentPDA,
            owner,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return { constraintPDA, tx };
    }
    /** Execute slashing (admin only). Funds move into the escrow vault. */
    async executeSlash(agentPDA, reason, slashAmount) {
        const authority = this.program.provider.publicKey;
        const [configPDA] = this.findConfigPDA();
        const [vaultPDA] = this.findVaultPDA();
        const [bondPDA] = this.findBondPDA(agentPDA);
        const config = await this.accounts.config.fetch(configPDA);
        const [slashPDA] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("slash"), agentPDA.toBuffer(), config.totalSlashed.toArrayLike(Buffer, "le", 8)], this.program.programId);
        const tx = await this.program.methods
            .executeSlash(reason, slashAmount)
            .accounts({
            config: configPDA,
            vault: vaultPDA,
            agent: agentPDA,
            bond: bondPDA,
            slashRecord: slashPDA,
            authority,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return { slashPDA, tx };
    }
    /** Pay a victim out of the escrow vault (admin only) */
    async compensateVictim(agentPDA, slashNonce, victim, amount) {
        const authority = this.program.provider.publicKey;
        const [configPDA] = this.findConfigPDA();
        const [vaultPDA] = this.findVaultPDA();
        const [slashPDA] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("slash"), agentPDA.toBuffer(), slashNonce.toArrayLike(Buffer, "le", 8)], this.program.programId);
        const tx = await this.program.methods
            .compensateVictim(amount)
            .accounts({
            config: configPDA,
            vault: vaultPDA,
            slashRecord: slashPDA,
            agent: agentPDA,
            victim,
            authority,
        })
            .rpc();
        return { tx };
    }
    /** Fetch agent */
    async getAgent(agentPDA) {
        return this.accounts.agent.fetch(agentPDA);
    }
    /** Fetch bond */
    async getBond(bondPDA) {
        return this.accounts.bond.fetch(bondPDA);
    }
    /** Fetch config */
    async getConfig() {
        const [configPDA] = this.findConfigPDA();
        return this.accounts.config.fetch(configPDA);
    }
    /** Fetch the escrow vault, including how much is available to victims */
    async getVault() {
        const [vaultPDA] = this.findVaultPDA();
        const vault = await this.accounts.vault.fetch(vaultPDA);
        return {
            ...vault,
            available: vault.totalSlashed.sub(vault.totalCompensated),
        };
    }
    /* ---------------------------------------------------------------------- */
    /* Read layer                                                             */
    /*                                                                        */
    /* The write path above is only useful if a counterparty can ask "does    */
    /* this agent have collateral at risk, and has it ever been slashed?"     */
    /* These methods answer exactly that, over plain `getProgramAccounts`.    */
    /* ---------------------------------------------------------------------- */
    /** Public RPC connection this client queries. */
    getConnection() {
        return this.connection;
    }
    /** This program's on-chain address. */
    getProgramId() {
        return this.program.programId;
    }
    /**
     * Build a `Program`-free `AccountFetcher` backed by this client's connection.
     * Returning the interface (rather than fetching inline) is what lets the
     * read layer be unit tested against a fake.
     */
    getAccountFetcher() {
        return {
            getProgramAccounts: (programId, config) => this.connection.getProgramAccounts(programId, config),
        };
    }
    /**
     * Account discriminators come from the IDL rather than being recomputed here.
     * `tests/unit/sdk.test.ts` pins the IDL's values to `sha256("account:" + Name)`,
     * so a stale IDL fails the suite instead of silently returning zero accounts.
     */
    accountDiscriminator(name) {
        const accounts = IDL
            .accounts ?? [];
        const found = accounts.find((a) => a.name === name);
        if (!found)
            throw new Error(`IDL does not declare an account named "${name}"`);
        return Buffer.from(found.discriminator);
    }
    /** Decoders backed by Anchor's own account coder, so layouts come from the IDL. */
    get decoders() {
        return {
            agent: (d) => this.program.coder.accounts.decode("agent", d),
            bond: (d) => this.program.coder.accounts.decode("bond", d),
            constraint: (d) => this.program.coder.accounts.decode("constraint", d),
            slashRecord: (d) => this.program.coder.accounts.decode("slashRecord", d),
        };
    }
    /** Every agent this program has registered. */
    async listAgents() {
        return (0, read_1.listAgents)(this.getAccountFetcher(), this.getProgramId(), this.decoders, { Agent: this.accountDiscriminator("Agent") });
    }
    /** Every bond in existence. */
    async listBonds() {
        return (0, read_1.listBonds)(this.getAccountFetcher(), this.getProgramId(), this.decoders, { Bond: this.accountDiscriminator("Bond") });
    }
    /** Slash history for one agent (or the whole program when `agent` is omitted). */
    async listSlashRecords(agent) {
        return (0, read_1.listSlashRecords)(this.getAccountFetcher(), this.getProgramId(), this.decoders, { SlashRecord: this.accountDiscriminator("SlashRecord") }, agent);
    }
    /** Constraints attached to one agent (or the whole program when omitted). */
    async listConstraints(agent) {
        return (0, read_1.listConstraints)(this.getAccountFetcher(), this.getProgramId(), this.decoders, { Constraint: this.accountDiscriminator("Constraint") }, agent);
    }
    /**
     * The public trust profile for one agent: bond, slash history, derived grade.
     * This is the single call a counterparty or a judge needs.
     */
    async getTrustProfile(agentPDA, now = Math.floor(Date.now() / 1000)) {
        const agent = await this.getAgent(agentPDA);
        // A bond PDA is derived from the agent, so this is a point read, not a scan.
        const [bondPDA] = this.findBondPDA(agentPDA);
        let bond = null;
        try {
            bond = await this.getBond(bondPDA);
        }
        catch {
            // Anchor throws when the account does not exist. No bond is a valid state.
            bond = null;
        }
        const slashes = await this.listSlashRecords(agentPDA);
        return (0, read_1.buildTrustProfile)({
            agent: {
                address: agentPDA,
                owner: agent.owner,
                name: agent.name,
                trustScore: agent.trustScore,
                status: agent.status,
            },
            bond: bond
                ? {
                    address: bondPDA,
                    amount: BigInt(bond.amount.toString()),
                    lockedAt: Number(bond.lockedAt.toString()),
                    expiresAt: Number(bond.expiresAt.toString()),
                    isActive: bond.isActive,
                }
                : null,
            slashes: slashes.map(({ address, data }) => ({
                address,
                amount: BigInt(data.amount.toString()),
                reason: data.reason,
                timestamp: Number(data.timestamp.toString()),
                victim: data.victim?.toBase58() ?? null,
                compensated: data.compensated,
                nonce: BigInt(data.nonce.toString()),
            })),
            now,
        });
    }
}
exports.EquxiClient = EquxiClient;
//# sourceMappingURL=index.js.map