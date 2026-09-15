import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  AccountFetcher,
  Located,
  TrustProfile,
  buildTrustProfile,
  listAgents,
  listBonds,
  listConstraints,
  listSlashRecords,
} from "./read";

export * from "./read";

const PROGRAM_ID = new PublicKey("D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc");
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/** Maximum number of constraints the program allows per agent. */
export const MAX_CONSTRAINTS = 16;

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
import RAW_IDL from "./idl/equxi.json";

const IDL = RAW_IDL as unknown as anchor.Idl;

export class EquxiClient {
  private program: Program;
  private connection: Connection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private accounts: any;

  constructor(provider: AnchorProvider) {
    this.program = new Program(IDL, provider);
    this.connection = provider.connection;
    this.accounts = this.program.account;
  }

  /** Derive config PDA */
  findConfigPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], this.program.programId);
  }

  /** Derive the escrow vault PDA */
  findVaultPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("vault")], this.program.programId);
  }

  /** Derive this program's ProgramData PDA (needed by `initialize`) */
  findProgramDataPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [this.program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    );
  }

  /** Derive agent PDA */
  findAgentPDA(operator: PublicKey, name: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)],
      this.program.programId
    );
  }

  /** Derive bond PDA */
  findBondPDA(agentPDA: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      this.program.programId
    );
  }

  /** Derive a constraint PDA from the agent's current constraint index */
  findConstraintPDA(agentPDA: PublicKey, index: number): [PublicKey, number] {
    const idx = Buffer.alloc(2);
    idx.writeUInt16LE(index, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("constraint"), agentPDA.toBuffer(), idx],
      this.program.programId
    );
  }

  /**
   * Initialize the program. Must be signed by the program's upgrade authority,
   * which becomes the slash/compensation admin.
   */
  async initialize() {
    const payer = this.program.provider.publicKey!;
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
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { configPDA, vaultPDA, tx };
  }

  /** Register a new agent */
  async registerAgent(name: string, agentType: any) {
    const operator = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const [agentPDA] = this.findAgentPDA(operator, name);

    const tx = await this.program.methods
      .registerAgent(name, agentType)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        operator,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { agentPDA, tx };
  }

  /**
   * Create a bond. The agent's owner must sign and fund it — this is what stops
   * a third party from squatting an agent's bond PDA.
   */
  async createBond(agentPDA: PublicKey, amount: BN, lockDuration: BN) {
    const owner = this.program.provider.publicKey!;
    const agent = await this.accounts.agent.fetch(agentPDA);

    if (agent.owner.toString() !== owner.toString()) {
      throw new Error(
        `Only the agent owner (${agent.owner.toString()}) can create this bond`
      );
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
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { bondPDA, tx };
  }

  /** Withdraw (and close) the bond after the lock expires */
  async withdrawBond(agentPDA: PublicKey) {
    const operator = this.program.provider.publicKey!;
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
  async addConstraint(agentPDA: PublicKey, constraintType: any, params: any) {
    const owner = this.program.provider.publicKey!;
    const agent = await this.accounts.agent.fetch(agentPDA);

    if (agent.constraintCount >= MAX_CONSTRAINTS) {
      throw new Error(`Agent already has the maximum ${MAX_CONSTRAINTS} constraints`);
    }

    const [constraintPDA] = this.findConstraintPDA(agentPDA, agent.constraintCount);

    const tx = await this.program.methods
      .addConstraint(constraintType, params)
      .accounts({
        constraint: constraintPDA,
        agent: agentPDA,
        owner,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { constraintPDA, tx };
  }

  /** Execute slashing (admin only). Funds move into the escrow vault. */
  async executeSlash(agentPDA: PublicKey, reason: string, slashAmount: BN) {
    const authority = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const [vaultPDA] = this.findVaultPDA();
    const [bondPDA] = this.findBondPDA(agentPDA);
    const config = await this.accounts.config.fetch(configPDA);
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), config.totalSlashed.toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );

    const tx = await this.program.methods
      .executeSlash(reason, slashAmount)
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        agent: agentPDA,
        bond: bondPDA,
        slashRecord: slashPDA,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { slashPDA, tx };
  }

  /** Pay a victim out of the escrow vault (admin only) */
  async compensateVictim(agentPDA: PublicKey, slashNonce: BN, victim: PublicKey, amount: BN) {
    const authority = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const [vaultPDA] = this.findVaultPDA();
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), slashNonce.toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );

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
  async getAgent(agentPDA: PublicKey) {
    return this.accounts.agent.fetch(agentPDA);
  }

  /** Fetch bond */
  async getBond(bondPDA: PublicKey) {
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
  getConnection(): Connection {
    return this.connection;
  }

  /** This program's on-chain address. */
  getProgramId(): PublicKey {
    return this.program.programId;
  }

  /**
   * Build a `Program`-free `AccountFetcher` backed by this client's connection.
   * Returning the interface (rather than fetching inline) is what lets the
   * read layer be unit tested against a fake.
   */
  getAccountFetcher(): AccountFetcher {
    return {
      getProgramAccounts: (programId, config) =>
        this.connection.getProgramAccounts(programId, config) as never,
    };
  }

  /**
   * Account discriminators come from the IDL rather than being recomputed here.
   * `tests/unit/sdk.test.ts` pins the IDL's values to `sha256("account:" + Name)`,
   * so a stale IDL fails the suite instead of silently returning zero accounts.
   */
  private accountDiscriminator(name: string): Buffer {
    const accounts =
      (IDL as unknown as { accounts?: Array<{ name: string; discriminator: number[] }> })
        .accounts ?? [];
    const found = accounts.find((a) => a.name === name);
    if (!found) throw new Error(`IDL does not declare an account named "${name}"`);
    return Buffer.from(found.discriminator);
  }

  /** Decoders backed by Anchor's own account coder, so layouts come from the IDL. */
  private get decoders() {
    return {
      agent: (d: Buffer) => this.program.coder.accounts.decode("agent", d),
      bond: (d: Buffer) => this.program.coder.accounts.decode("bond", d),
      constraint: (d: Buffer) => this.program.coder.accounts.decode("constraint", d),
      slashRecord: (d: Buffer) => this.program.coder.accounts.decode("slashRecord", d),
    };
  }

  /** Every agent this program has registered. */
  async listAgents(): Promise<Located<Record<string, unknown>>[]> {
    return listAgents(
      this.getAccountFetcher(),
      this.getProgramId(),
      this.decoders as never,
      { Agent: this.accountDiscriminator("Agent") }
    );
  }

  /** Every bond in existence. */
  async listBonds(): Promise<Located<Record<string, unknown>>[]> {
    return listBonds(
      this.getAccountFetcher(),
      this.getProgramId(),
      this.decoders as never,
      { Bond: this.accountDiscriminator("Bond") }
    );
  }

  /** Slash history for one agent (or the whole program when `agent` is omitted). */
  async listSlashRecords(agent?: PublicKey): Promise<Located<Record<string, unknown>>[]> {
    return listSlashRecords(
      this.getAccountFetcher(),
      this.getProgramId(),
      this.decoders as never,
      { SlashRecord: this.accountDiscriminator("SlashRecord") },
      agent
    );
  }

  /** Constraints attached to one agent (or the whole program when omitted). */
  async listConstraints(agent?: PublicKey): Promise<Located<Record<string, unknown>>[]> {
    return listConstraints(
      this.getAccountFetcher(),
      this.getProgramId(),
      this.decoders as never,
      { Constraint: this.accountDiscriminator("Constraint") },
      agent
    );
  }

  /**
   * The public trust profile for one agent: bond, slash history, derived grade.
   * This is the single call a counterparty or a judge needs.
   */
  async getTrustProfile(agentPDA: PublicKey, now = Math.floor(Date.now() / 1000)): Promise<TrustProfile> {
    const agent = await this.getAgent(agentPDA);

    // A bond PDA is derived from the agent, so this is a point read, not a scan.
    const [bondPDA] = this.findBondPDA(agentPDA);
    let bond: Awaited<ReturnType<EquxiClient["getBond"]>> | null = null;
    try {
      bond = await this.getBond(bondPDA);
    } catch {
      // Anchor throws when the account does not exist. No bond is a valid state.
      bond = null;
    }

    const slashes = await this.listSlashRecords(agentPDA);

    return buildTrustProfile({
      agent: {
        address: agentPDA,
        owner: agent.owner as PublicKey,
        name: agent.name as string,
        trustScore: agent.trustScore as number,
        status: agent.status as unknown as number,
      },
      bond: bond
        ? {
            address: bondPDA,
            amount: BigInt((bond.amount as BN).toString()),
            lockedAt: Number((bond.lockedAt as BN).toString()),
            expiresAt: Number((bond.expiresAt as BN).toString()),
            isActive: bond.isActive as boolean,
          }
        : null,
      slashes: slashes.map(({ address, data }) => ({
        address,
        amount: BigInt((data.amount as BN).toString()),
        reason: data.reason as string,
        timestamp: Number((data.timestamp as BN).toString()),
        victim: (data.victim as PublicKey | null)?.toBase58() ?? null,
        compensated: data.compensated as boolean,
        nonce: BigInt((data.nonce as BN).toString()),
      })),
      now,
    });
  }
}
