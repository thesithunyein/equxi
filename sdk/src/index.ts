import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("9p47LiT9ondNZwhC1dqC6ChMTNr7mRLc3RGvi39JVemQ");

// IDL placeholder - replace with actual IDL after `anchor build`
const IDL: any = {
  version: "0.1.0",
  name: "equxi",
  instructions: [
    { name: "initialize", accounts: [
      { name: "config", isMut: true, isSigner: false },
      { name: "payer", isMut: true, isSigner: true },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [{ name: "admin", type: "publicKey" }] },
    { name: "registerAgent", accounts: [
      { name: "config", isMut: false, isSigner: false },
      { name: "agent", isMut: true, isSigner: false },
      { name: "operator", isMut: true, isSigner: true },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [
      { name: "name", type: "string" },
      { name: "agentType", type: { defined: "AgentType" } },
    ] },
    { name: "createBond", accounts: [
      { name: "config", isMut: false, isSigner: false },
      { name: "bond", isMut: true, isSigner: false },
      { name: "agent", isMut: true, isSigner: false },
      { name: "operator", isMut: true, isSigner: true },
      { name: "owner", isMut: false, isSigner: false },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [
      { name: "amount", type: "u64" },
      { name: "lockDuration", type: "i64" },
    ] },
    { name: "withdrawBond", accounts: [
      { name: "bond", isMut: true, isSigner: false },
      { name: "agent", isMut: true, isSigner: false },
      { name: "operator", isMut: true, isSigner: true },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [] },
    { name: "addConstraint", accounts: [
      { name: "config", isMut: false, isSigner: false },
      { name: "constraint", isMut: true, isSigner: false },
      { name: "agent", isMut: true, isSigner: false },
      { name: "owner", isMut: true, isSigner: true },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [
      { name: "constraintType", type: { defined: "ConstraintType" } },
      { name: "params", type: { defined: "ConstraintParams" } },
    ] },
    { name: "executeSlash", accounts: [
      { name: "config", isMut: false, isSigner: false },
      { name: "agent", isMut: true, isSigner: false },
      { name: "bond", isMut: true, isSigner: false },
      { name: "slashRecord", isMut: true, isSigner: false },
      { name: "owner", isMut: false, isSigner: false },
      { name: "authority", isMut: false, isSigner: true },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [
      { name: "reason", type: "string" },
      { name: "slashAmount", type: "u64" },
    ] },
    { name: "compensateVictim", accounts: [
      { name: "config", isMut: false, isSigner: false },
      { name: "slashRecord", isMut: true, isSigner: false },
      { name: "bond", isMut: true, isSigner: false },
      { name: "agent", isMut: true, isSigner: false },
      { name: "victim", isMut: true, isSigner: false },
      { name: "authority", isMut: true, isSigner: true },
      { name: "systemProgram", isMut: false, isSigner: false },
    ], args: [{ name: "amount", type: "u64" }] },
  ],
  accounts: [
    { name: "Config", type: { kind: "struct", fields: [
      { name: "admin", type: "publicKey" },
      { name: "totalAgents", type: "u64" },
      { name: "totalBonds", type: "u64" },
      { name: "totalSlashed", type: "u64" },
      { name: "bumped", type: "u8" },
    ]}},
    { name: "Agent", type: { kind: "struct", fields: [
      { name: "owner", type: "publicKey" },
      { name: "name", type: { array: ["u8", 32] } },
      { name: "agentType", type: { defined: "AgentType" } },
      { name: "trustScore", type: "u8" },
      { name: "status", type: { defined: "AgentStatus" } },
      { name: "bondAddress", type: "publicKey" },
      { name: "createdAt", type: "i64" },
      { name: "bumped", type: "u8" },
    ]}},
    { name: "Bond", type: { kind: "struct", fields: [
      { name: "agent", type: "publicKey" },
      { name: "operator", type: "publicKey" },
      { name: "amount", type: "u64" },
      { name: "lockDuration", type: "i64" },
      { name: "lockedAt", type: "i64" },
      { name: "expiresAt", type: "i64" },
      { name: "isActive", type: "bool" },
      { name: "bumped", type: "u8" },
    ]}},
    { name: "SlashRecord", type: { kind: "struct", fields: [
      { name: "agent", type: "publicKey" },
      { name: "authority", type: "publicKey" },
      { name: "amount", type: "u64" },
      { name: "reason", type: { array: ["u8", 128] } },
      { name: "nonce", type: "u64" },
      { name: "timestamp", type: "i64" },
      { name: "victim", type: { option: "publicKey" } },
      { name: "compensated", type: "bool" },
      { name: "bumped", type: "u8" },
    ]}},
  ],
  types: [
    { name: "AgentType", type: { kind: "enum", variants: [
      "Trader", "Oracle", "DeFi", "Payment", "NFT", "Governance", "Bridge", "Custom"
    ]}},
    { name: "AgentStatus", type: { kind: "enum", variants: [
      "Active", "Pending", "Slashed", "Deactivated"
    ]}},
    { name: "ConstraintType", type: { kind: "enum", variants: [
      "SpendLimit", "ProgramAllowlist", "Timelock", "Velocity", "Custom"
    ]}},
    { name: "ConstraintParams", type: { kind: "struct", fields: [
      { name: "maxAmount", type: "u64" },
      { name: "maxPerPeriod", type: "u64" },
      { name: "periodSeconds", type: "i64" },
      { name: "timelockSeconds", type: "i64" },
      { name: "allowedPrograms", type: { array: ["publicKey", 8] } },
    ]}},
  ],
};

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

  /** Create a bond */
  async createBond(agentPDA: PublicKey, amount: BN, lockDuration: BN) {
    const operator = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const [bondPDA] = this.findBondPDA(agentPDA);
    const agent = await this.accounts.agent.fetch(agentPDA);

    const tx = await this.program.methods
      .createBond(amount, lockDuration)
      .accounts({
        config: configPDA,
        bond: bondPDA,
        agent: agentPDA,
        operator,
        owner: agent.owner,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { bondPDA, tx };
  }

  /** Withdraw bond after lock expires */
  async withdrawBond(agentPDA: PublicKey) {
    const operator = this.program.provider.publicKey!;
    const [bondPDA] = this.findBondPDA(agentPDA);

    const tx = await this.program.methods
      .withdrawBond()
      .accounts({
        bond: bondPDA,
        agent: agentPDA,
        operator,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { tx };
  }

  /** Add a constraint */
  async addConstraint(agentPDA: PublicKey, constraintType: any, params: any) {
    const owner = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const config = await this.accounts.config.fetch(configPDA);
    const [constraintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraint"), agentPDA.toBuffer(), config.totalBonds.add(new BN(1)).toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );

    const tx = await this.program.methods
      .addConstraint(constraintType, params)
      .accounts({
        config: configPDA,
        constraint: constraintPDA,
        agent: agentPDA,
        owner,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { constraintPDA, tx };
  }

  /** Execute slashing (admin only) */
  async executeSlash(agentPDA: PublicKey, reason: string, slashAmount: BN) {
    const authority = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const config = await this.accounts.config.fetch(configPDA);
    const [bondPDA] = this.findBondPDA(agentPDA);
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), config.totalSlashed.toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );
    const agent = await this.accounts.agent.fetch(agentPDA);

    const tx = await this.program.methods
      .executeSlash(reason, slashAmount)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        bond: bondPDA,
        slashRecord: slashPDA,
        owner: agent.owner,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { slashPDA, tx };
  }

  /** Compensate victim */
  async compensateVictim(agentPDA: PublicKey, slashNonce: BN, victim: PublicKey, amount: BN) {
    const authority = this.program.provider.publicKey!;
    const [configPDA] = this.findConfigPDA();
    const [slashPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("slash"), agentPDA.toBuffer(), slashNonce.toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );
    const [bondPDA] = this.findBondPDA(agentPDA);

    const tx = await this.program.methods
      .compensateVictim(amount)
      .accounts({
        config: configPDA,
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
}
