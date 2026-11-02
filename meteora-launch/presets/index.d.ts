/**
 * Type declarations for `meteora-launch/presets/index.js`.
 *
 * Same shape as the other hand-written declarations in this repo: the module is
 * CommonJS, so the interfaces are exported from a namespace merged onto the
 * callable module object.
 */

declare namespace presets {
  /** One DBC config preset, as published in this directory. */
  interface Preset {
    name: string;
    version: number;
    title?: string;
    summary: string;
    useCase?: string;
    why?: string;
    token: {
      tokenType: string;
      tokenBaseDecimal: number;
      tokenQuoteDecimal: number;
      tokenAuthorityOption: string;
      totalTokenSupply: number;
      leftover?: number;
    };
    fee: {
      baseFeeMode: string;
      startingFeeBps: number;
      endingFeeBps: number;
      numberOfPeriod?: number;
      totalDuration?: number;
      dynamicFeeEnabled?: boolean;
      collectFeeMode: string;
      creatorTradingFeePercentage: number;
      poolCreationFee?: number;
      enableFirstSwapWithMinFee?: boolean;
    };
    migration: {
      migrationOption: string;
      migrationFeeOption: string;
      migrationFee: { feePercentage: number; creatorFeePercentage: number };
      migratedPoolFee: {
        collectFeeMode: string;
        dynamicFee: string;
        poolFeeBps: number;
        baseFeeMode: string;
      };
    };
    liquidityDistribution?: Record<string, number>;
    curve: {
      shape?: string;
      activationType: string;
      sqrtPrices: number[];
      liquidityWeights: number[];
      raisesQuoteSol?: number;
      graduatesAtSol?: number;
      note?: string;
    };
    escrow: {
      protocol: string;
      fundedBy: string;
      bondLamports: number;
      bondLockSeconds: number;
      note?: string;
    };
    ordering: { mustClaimTradingFeesBeforeMigration: boolean; reason?: string };
    provenance?: Record<string, unknown>;
  }

  interface ValidationReport {
    ok: boolean;
    errors: string[];
  }

  /** Every preset publishes for this protocol's escrow step. */
  const PROTOCOL: string;

  /** The only migration target the safety-escrow step can claim proceeds from. */
  const REQUIRED_MIGRATION: string;

  /** Dotted paths whose value names a DBC SDK enum member, not a literal. */
  const ENUM_FIELDS: string[];

  /** Read a dotted path without throwing on a missing branch. */
  function get(object: unknown, dotted: string): unknown;

  /** Check a preset against the invariants a wrong value breaks silently. */
  function validatePreset(preset: unknown): ValidationReport;

  /** Read and validate one preset by name. Throws with every reason it failed. */
  function loadPreset(name: string): Preset;

  /** The presets published here, by name, sorted. */
  function listPresets(): string[];
}

export = presets;
