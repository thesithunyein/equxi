import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Equxi } from "../types/equxi";

export { Equxi };
export type { Agent, Bond, Constraint, SlashRecord } from "../types/equxi";

const PROGRAM_ID = new PublicKey("EQUxi11111111111111111111111111111111111111111");

export class EquxiClient {
  private program: Program<Equxi>;
  private connection: Connection;

  constructor(provider: AnchorProvider) {
    this.program = new Program<Equxi>(idl as any, provider);
    this.connection = provider.connection;
  }

  /**
   * Register a new AI agent
   */
  async registerAgent(
    name: string,
    agentType: { trader: {} } | { oracle: {} } | { defi: {} } | { payment: {} } | { nft: {} } | { governance: {} } | { bridge: {} } | { custom: {} }
  ) {
    const operator = this.program.provider.publicKey!;
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)],
      this.program.programId
    );

    const tx = await this.program.methods
      .registerAgent(name, agentType)
      .accounts({
        agent: agentPDA,
        operator,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { agentPDA, tx };
  }

  /**
   * Create a bond for an agent
   */
  async createBond(agentPDA: PublicKey, amount: BN, lockDuration: BN) {
    const operator = this.program.provider.publicKey!;
    const [bondPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      this.program.programId
    );

    const agent = await this.program.account.agent.fetch(agentPDA);

    const tx = await this.program.methods
      .createBond(amount, lockDuration)
      .accounts({
        bond: bondPDA,
        agent: agentPDA,
        operator,
        owner: agent.owner,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { bondPDA, tx };
  }

  /**
   * Add a behavioral constraint
   */
  async addConstraint(
    agentPDA: PublicKey,
    constraintType: { spendLimit: {} } | { programAllowlist: {} } | { timelock: {} } | { velocity: {} } | { custom: {} },
    params: {
      maxAmount: BN;
      maxPerPeriod: BN;
      periodSeconds: BN;
      timelockSeconds: BN;
      allowedPrograms: PublicKey[];
    }
  ) {
    const owner = this.program.provider.publicKey!;
    const typeBytes = Object.keys(constraintType)[0];
    const [constraintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraint"), agentPDA.toBuffer(), Buffer.from(typeBytes)],
      this.program.programId
    );

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

  /**
   * Execute slashing against an agent's bond
   */
  async executeSlash(agentPDA: PublicKey, reason: string, slashAmount: BN) {
    const authority = this.program.provider.publicKey!;
    const timestamp = Math.floor(Date.now() / 1000);
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("slash"),
        agentPDA.toBuffer(),
        new BN(timestamp).toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );

    const [bondPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      this.program.programId
    );

    const tx = await this.program.methods
      .executeSlash(reason, slashAmount)
      .accounts({
        agent: agentPDA,
        bond: bondPDA,
        slashRecord: slashPDA,
        owner: authority,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { slashPDA, tx };
  }

  /**
   * Compensate a victim from a slashed bond
   */
  async compensateVictim(
    agentPDA: PublicKey,
    slashTimestamp: BN,
    victim: PublicKey,
    amount: BN
  ) {
    const authority = this.program.provider.publicKey!;
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), slashTimestamp.toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );
    const [bondPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      this.program.programId
    );

    const tx = await this.program.methods
      .compensateVictim(amount)
      .accounts({
        slashRecord: slashPDA,
        bond: bondPDA,
        agent: agentPDA,
        victim,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { tx };
  }

  /**
   * Fetch agent data
   */
  async getAgent(agentPDA: PublicKey) {
    return this.program.account.agent.fetch(agentPDA);
  }

  /**
   * Fetch bond data
   */
  async getBond(bondPDA: PublicKey) {
    return this.program.account.bond.fetch(bondPDA);
  }

  /**
   * Find agent PDA
   */
  findAgentPDA(operator: PublicKey, name: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)],
      this.program.programId
    );
  }

  /**
   * Find bond PDA
   */
  findBondPDA(agentPDA: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), agentPDA.toBuffer()],
      this.program.programId
    );
  }
}

// IDL placeholder - will be generated by Anchor
const idl = {
  version: "0.1.0",
  name: "equxi",
  instructions: [],
  accounts: [],
  types: [],
};
