/**
 * EquxiService — wraps all on-chain interactions with the Equxi Anchor program.
 *
 * Provides: registerAgent, lockBond, addConstraint, slashBond, getConfig, getAgent, getBond.
 */
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { IAgentRuntime } from "@elizaos/core";

// Equxi program config — update these for mainnet
const EQUXI_PROGRAM_ID = new PublicKey(
  "D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc"
);
const SOLANA_RPC = "https://api.devnet.solana.com";

// Agent types
export enum AgentType {
  Trader = 0,
  Executor = 1,
  Analyst = 2,
  Custom = 3,
}

// Constraint types
export enum ConstraintType {
  SpendLimit = 0,
  ProgramAllowlist = 1,
  TimeLock = 2,
  VelocityLimit = 3,
}

// PDA helpers
function findConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    EQUXI_PROGRAM_ID
  );
}

function findAgentPDA(operator: PublicKey, name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), operator.toBuffer(), Buffer.from(name)],
    EQUXI_PROGRAM_ID
  );
}

function findBondPDA(agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bond"), agent.toBuffer()],
    EQUXI_PROGRAM_ID
  );
}

function findConstraintPDA(
  agent: PublicKey,
  nonce: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("constraint"),
      agent.toBuffer(),
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 8),
    ],
    EQUXI_PROGRAM_ID
  );
}

function findSlashRecordPDA(
  agent: PublicKey,
  nonce: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("slash"),
      agent.toBuffer(),
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 8),
    ],
    EQUXI_PROGRAM_ID
  );
}

export class EquxiService {
  static serviceType = "equxi";
  connection: Connection;
  programId: PublicKey = EQUXI_PROGRAM_ID;

  constructor(runtime?: IAgentRuntime) {
    const rpcUrl =
      runtime?.getSetting("SOLANA_RPC_URL") || SOLANA_RPC;
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  /**
   * Build a register_agent instruction.
   */
  async buildRegisterAgent(
    operator: PublicKey,
    name: string,
    agentType: AgentType
  ): Promise<anchor.web3.TransactionInstruction> {
    const [configPDA] = findConfigPDA();
    const [agentPDA] = findAgentPDA(operator, name);

    const idl = this.getIdl();
    const program = new anchor.Program(idl, this.programId, {
      connection: this.connection,
    });

    return program.methods
      .registerAgent(name, agentType)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        operator: operator,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build a create_bond instruction.
   */
  async buildLockBond(
    operator: PublicKey,
    agentName: string,
    amountLamports: number,
    lockDuration: number
  ): Promise<anchor.web3.TransactionInstruction> {
    const [configPDA] = findConfigPDA();
    const [agentPDA] = findAgentPDA(operator, agentName);
    const [bondPDA] = findBondPDA(agentPDA);

    const idl = this.getIdl();
    const program = new anchor.Program(idl, this.programId, {
      connection: this.connection,
    });

    return program.methods
      .createBond(new anchor.BN(amountLamports), new anchor.BN(lockDuration))
      .accounts({
        config: configPDA,
        bond: bondPDA,
        agent: agentPDA,
        operator: operator,
        owner: operator,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an add_constraint instruction.
   */
  async buildAddConstraint(
    owner: PublicKey,
    agentName: string,
    totalBonds: number,
    constraintType: ConstraintType,
    maxAmount: number,
    allowedPrograms: string[],
    lockDuration: number
  ): Promise<anchor.web3.TransactionInstruction> {
    const [configPDA] = findConfigPDA();
    const [agentPDA] = findAgentPDA(owner, agentName);
    const [constraintPDA] = findConstraintPDA(agentPDA, totalBonds + 1);

    const idl = this.getIdl();
    const program = new anchor.Program(idl, this.programId, {
      connection: this.connection,
    });

    const params = {
      maxAmount: new anchor.BN(maxAmount),
      allowedPrograms: allowedPrograms.map((p) => new PublicKey(p)),
      lockDuration: new anchor.BN(lockDuration),
      windowSeconds: new anchor.BN(0),
    };

    return program.methods
      .addConstraint(constraintType, params)
      .accounts({
        config: configPDA,
        constraint: constraintPDA,
        agent: agentPDA,
        owner: owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an execute_slash instruction.
   */
  async buildSlashBond(
    authority: PublicKey,
    agentOwner: PublicKey,
    agentName: string,
    slashAmount: number,
    reason: string
  ): Promise<anchor.web3.TransactionInstruction> {
    const [configPDA] = findConfigPDA();
    const [agentPDA] = findAgentPDA(agentOwner, agentName);
    const [bondPDA] = findBondPDA(agentPDA);

    // Get config to read total_slashed for nonce
    const configData = await this.getConfig();
    const nonce = configData ? configData.totalSlashed : 0;
    const [slashRecordPDA] = findSlashRecordPDA(agentPDA, nonce);

    const idl = this.getIdl();
    const program = new anchor.Program(idl, this.programId, {
      connection: this.connection,
    });

    return program.methods
      .executeSlash(reason, new anchor.BN(slashAmount))
      .accounts({
        config: configPDA,
        agent: agentPDA,
        bond: bondPDA,
        slashRecord: slashRecordPDA,
        authority: authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Read on-chain Config account.
   */
  async getConfig(): Promise<Record<string, any> | null> {
    try {
      const [configPDA] = findConfigPDA();
      const info = await this.connection.getAccountInfo(configPDA);
      if (!info) return null;

      // Decode manually — 8 byte discriminator + fields
      const data = info.data;
      let offset = 8; // skip discriminator

      const admin = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const totalAgents = data.readBigUInt64LE(offset);
      offset += 8;

      const totalBonds = data.readBigUInt64LE(offset);
      offset += 8;

      const totalSlashed = data.readBigUInt64LE(offset);
      offset += 8;

      const bumped = data[offset];

      return {
        admin: admin.toBase58(),
        totalAgents: Number(totalAgents),
        totalBonds: Number(totalBonds),
        totalSlashed: Number(totalSlashed),
        bumped,
      };
    } catch {
      return null;
    }
  }

  /**
   * Read on-chain Agent account.
   */
  async getAgent(
    operator: PublicKey,
    name: string
  ): Promise<Record<string, any> | null> {
    try {
      const [agentPDA] = findAgentPDA(operator, name);
      const info = await this.connection.getAccountInfo(agentPDA);
      if (!info) return null;

      const data = info.data;
      let offset = 8; // skip discriminator

      const owner = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const nameBytes = data.slice(offset, offset + 32);
      const agentName = Buffer.from(nameBytes)
        .toString("utf8")
        .replace(/\0/g, "");
      offset += 32;

      const agentType = data[offset];
      offset += 1;

      const trustScore = data[offset];
      offset += 1;

      const status = data[offset];
      offset += 1;

      const bondAddress = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const createdAt = data.readBigInt64LE(offset);

      return {
        owner: owner.toBase58(),
        name: agentName,
        agentType,
        trustScore,
        status,
        bondAddress: bondAddress.toBase58(),
        createdAt: Number(createdAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * Read on-chain Bond account.
   */
  async getBond(agentOwner: PublicKey, agentName: string): Promise<Record<string, any> | null> {
    try {
      const [agentPDA] = findAgentPDA(agentOwner, agentName);
      const [bondPDA] = findBondPDA(agentPDA);
      const info = await this.connection.getAccountInfo(bondPDA);
      if (!info) return null;

      const data = info.data;
      let offset = 8;

      const agent = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const operator = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const amount = data.readBigUInt64LE(offset);
      offset += 8;

      const lockDuration = data.readBigInt64LE(offset);
      offset += 8;

      const lockedAt = data.readBigInt64LE(offset);
      offset += 8;

      const expiresAt = data.readBigInt64LE(offset);
      offset += 8;

      const isActive = data[offset] === 1;

      return {
        agent: agent.toBase58(),
        operator: operator.toBase58(),
        amount: Number(amount),
        lockDuration: Number(lockDuration),
        lockedAt: Number(lockedAt),
        expiresAt: Number(expiresAt),
        isActive,
      };
    } catch {
      return null;
    }
  }

  /**
   * Minimal IDL for the Equxi program.
   * In production, use the Anchor-generated IDL from target/idl/equxi.json.
   */
  private getIdl(): any {
    return {
      version: "0.1.0",
      name: "equxi",
      instructions: [
        {
          name: "registerAgent",
          accounts: [
            { name: "config", isMut: true, isSigner: false },
            { name: "agent", isMut: true, isSigner: false },
            { name: "operator", isMut: true, isSigner: true },
            { name: "systemProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "name", type: "string" },
            { name: "agentType", type: { defined: "AgentType" } },
          ],
        },
        {
          name: "createBond",
          accounts: [
            { name: "config", isMut: true, isSigner: false },
            { name: "bond", isMut: true, isSigner: false },
            { name: "agent", isMut: true, isSigner: false },
            { name: "operator", isMut: true, isSigner: true },
            { name: "owner", isMut: false, isSigner: false },
            { name: "systemProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "amount", type: "u64" },
            { name: "lockDuration", type: "i64" },
          ],
        },
        {
          name: "addConstraint",
          accounts: [
            { name: "config", isMut: false, isSigner: false },
            { name: "constraint", isMut: true, isSigner: false },
            { name: "agent", isMut: true, isSigner: false },
            { name: "owner", isMut: true, isSigner: true },
            { name: "systemProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "constraintType", type: { defined: "ConstraintType" } },
            { name: "params", type: { defined: "ConstraintParams" } },
          ],
        },
        {
          name: "executeSlash",
          accounts: [
            { name: "config", isMut: true, isSigner: false },
            { name: "agent", isMut: true, isSigner: false },
            { name: "bond", isMut: true, isSigner: false },
            { name: "slashRecord", isMut: true, isSigner: false },
            { name: "authority", isMut: true, isSigner: true },
            { name: "systemProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "reason", type: "string" },
            { name: "slashAmount", type: "u64" },
          ],
        },
      ],
      types: [
        {
          name: "AgentType",
          type: {
            kind: "enum",
            variants: [
              { name: "Trader" },
              { name: "Executor" },
              { name: "Analyst" },
              { name: "Custom" },
            ],
          },
        },
        {
          name: "ConstraintType",
          type: {
            kind: "enum",
            variants: [
              { name: "SpendLimit" },
              { name: "ProgramAllowlist" },
              { name: "TimeLock" },
              { name: "VelocityLimit" },
            ],
          },
        },
        {
          name: "ConstraintParams",
          type: {
            kind: "struct",
            fields: [
              { name: "maxAmount", type: "u64" },
              { name: "allowedPrograms", type: { vec: "publicKey" } },
              { name: "lockDuration", type: "i64" },
              { name: "windowSeconds", type: "i64" },
            ],
          },
        },
      ],
    };
  }
}
