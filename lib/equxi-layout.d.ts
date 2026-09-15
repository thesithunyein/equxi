/**
 * Type declarations for `lib/equxi-layout.js`.
 *
 * The module itself is plain CommonJS JavaScript on purpose (see its header),
 * so this is the hand-written boundary. It uses `export =` because the runtime
 * really is `module.exports = { ... }`, and that keeps `require` interop exact
 * instead of guessing. If these types drift from the JavaScript, the tests fail:
 * `tests/unit/api.test.ts` exercises every function below against fixtures that
 * the independently written TypeScript decoder also reads.
 */
declare namespace EquxiLayout {
  interface AccountFilter {
    memcmp: { offset: number; bytes: string };
  }

  interface ConfigAccount {
    admin: string;
    totalAgents: number;
    totalBonds: number;
    totalSlashed: number;
    bumped: number;
  }

  interface VaultAccount {
    totalSlashedLamports: string;
    totalCompensatedLamports: string;
    availableLamports: string;
    bumped: number;
  }

  interface AgentAccount {
    /** Which on-chain layout the account was written with. */
    layout: "v1" | "v2";
    owner: string;
    name: string;
    agentType: string;
    trustScore: number;
    status: string;
    statusCode: number;
    bondAddress: string;
    constraintCount: number;
    createdAt: number;
  }

  interface BondAccount {
    agent: string;
    operator: string;
    amountLamports: string;
    amountSol: number;
    lockDuration: number;
    lockedAt: number;
    expiresAt: number;
    isActive: boolean;
  }

  interface ConstraintParamsAccount {
    maxAmountLamports: string;
    maxPerPeriod: string;
    periodSeconds: number;
    timelockSeconds: number;
    allowedPrograms: string[];
  }

  interface ConstraintAccount {
    agent: string;
    constraintType: string;
    params: ConstraintParamsAccount;
    isEnforced: boolean;
    createdAt: number;
  }

  interface SlashRecordAccount {
    agent: string;
    authority: string;
    amountLamports: string;
    amountSol: number;
    reason: string;
    nonce: string;
    timestamp: number;
    victim: string | null;
    compensated: boolean;
  }

  interface TrustProfileInput {
    agent: AgentAccount;
    bond: BondAccount | null;
    slashes: SlashRecordAccount[];
    now: number;
  }

  type TrustGrade = "A" | "B" | "C" | "D" | "F" | "ungraded";

  interface TrustProfileResult {
    grade: TrustGrade;
    score: number;
    onChainTrustScore: number;
    bond: {
      amountLamports: string;
      amountSol: number;
      lockedAt: number;
      expiresAt: number;
      isActive: boolean;
      locked: boolean;
      expired: boolean;
    } | null;
    slashes: Array<{
      nonce: string;
      amountLamports: string;
      amountSol: number;
      reason: string;
      timestamp: number;
      victim: string | null;
      compensated: boolean;
    }>;
    stats: {
      slashCount: number;
      openSlashes: number;
      totalSlashedLamports: string;
      totalSlashedSol: number;
      compensationPaidLamports: string;
      uncompensatedLamports: string;
      slashRatePerMonth: number;
    };
    warnings: string[];
  }

  const PROGRAM_ID: string;
  const DEFAULT_RPC: string;
  const LAMPORTS_PER_SOL: number;
  const ACCOUNT_DISCRIMINATORS: Record<string, number[]>;
  const ACCOUNT_SIZES: Record<string, number>;
  const AGENT_LAYOUT_V1_SIZE: number;
  const AGENT_LAYOUT_V2_SIZE: number;
  const OFFSETS: Record<string, Record<string, number>>;
  const AGENT_TYPE_NAMES: string[];
  const AGENT_STATUS_NAMES: string[];
  const CONSTRAINT_TYPE_NAMES: string[];

  function bs58Encode(bytes: Uint8Array): string;
  function bs58Decode(text: string): Uint8Array;
  function isPubkey(value: unknown): boolean;
  function discriminatorFilter(name: string): AccountFilter;
  function pubkeyFilter(pubkey: string, offset: number): AccountFilter;
  function decodeConfig(data: Uint8Array): ConfigAccount;
  function decodeVault(data: Uint8Array): VaultAccount;
  function decodeAgent(data: Uint8Array): AgentAccount;
  function decodeBond(data: Uint8Array): BondAccount;
  function decodeConstraint(data: Uint8Array): ConstraintAccount;
  function decodeSlashRecord(data: Uint8Array): SlashRecordAccount;
  function buildTrustProfile(input: TrustProfileInput): TrustProfileResult;
}

export = EquxiLayout;
