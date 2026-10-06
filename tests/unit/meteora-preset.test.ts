import { expect } from "chai";
import presets from "../../meteora-launch/presets/index";
import launchState from "../../meteora-launch/launch-state.json";

/* ── Meteora DBC config presets ───────────────────────────────────────── */

describe("meteora DBC presets (meteora-launch/presets)", () => {
  const NAME = "safety-escrow";

  type Preset = ReturnType<typeof presets.loadPreset>;

  /** A deep copy, so a mutation test cannot leak into the next assertion. */
  function clone(): Preset {
    return JSON.parse(JSON.stringify(presets.loadPreset(NAME))) as Preset;
  }

  it("publishes the safety-escrow preset and loads it", () => {
    expect(presets.listPresets()).to.include(NAME);

    const preset = presets.loadPreset(NAME);
    expect(preset.name).to.equal(NAME);
    expect(preset.version).to.be.greaterThan(0);
    expect(preset.summary).to.be.a("string");
    expect(presets.validatePreset(preset).ok).to.equal(true);
  });

  it("routes graduation proceeds to the agent's collateral, not to a wallet", () => {
    const preset = presets.loadPreset(NAME);

    // The escrow step is the whole point: the creator's cut of the migration
    // fee is what funds the bond, so both knobs have to be non-zero.
    expect(preset.escrow.protocol).to.equal(presets.PROTOCOL);
    expect(preset.escrow.fundedBy).to.equal("migrationFee.creatorFee");
    expect(preset.migration.migrationOption).to.equal(presets.REQUIRED_MIGRATION);
    expect(preset.migration.migrationFee.feePercentage).to.be.greaterThan(0);
    expect(preset.migration.migrationFee.creatorFeePercentage).to.be.greaterThan(0);
    expect(preset.fee.creatorTradingFeePercentage).to.equal(50);
  });

  it("encodes the ordering the chain taught us, so it cannot be lost", () => {
    const preset = presets.loadPreset(NAME);
    expect(preset.ordering.mustClaimTradingFeesBeforeMigration).to.equal(true);
    expect(preset.ordering.reason).to.include("fee vaults");
  });

  it("names a DBC SDK enum member in every enum slot", () => {
    const preset = presets.loadPreset(NAME);

    expect(presets.ENUM_FIELDS.length).to.be.greaterThan(0);
    for (const field of presets.ENUM_FIELDS) {
      const value = presets.get(preset, field);
      expect(value, field).to.be.a("string");
      expect((value as string).trim(), field).to.not.equal("");
    }
  });

  it("cannot drift from the launch it describes", () => {
    const provenance = presets.loadPreset(NAME).provenance as Record<string, string>;

    // The preset claims to be the config behind one specific devnet run. Pin
    // every address to the state file that run wrote, so a later edit to either
    // side fails here instead of quietly publishing a preset that never ran.
    expect(provenance.config).to.equal(launchState.config);
    expect(provenance.baseMint).to.equal(launchState.baseMint);
    expect(provenance.pool).to.equal(launchState.pool);
    expect(provenance.dammV2Config).to.equal(launchState.dammConfig);
    expect(provenance.agent).to.equal(launchState.agent);
    expect(provenance.bond).to.equal(launchState.bond);

    const preset = presets.loadPreset(NAME);
    expect(preset.escrow.bondLamports).to.equal(Number(launchState.bondLamports));
  });

  it("rejects the values that break silently", () => {
    function errorsAfter(mutate: (preset: Preset) => void): string[] {
      const preset = clone();
      mutate(preset);
      return presets.validatePreset(preset).errors;
    }

    // A fee percentage over 100 is arithmetically meaningless, not a type error.
    expect(errorsAfter((p) => (p.fee.creatorTradingFeePercentage = 150)).join()).to.include(
      "creatorTradingFeePercentage"
    );
    expect(
      errorsAfter((p) => (p.migration.migrationFee.creatorFeePercentage = 101)).join()
    ).to.include("creatorFeePercentage");

    // A curve whose weights do not describe its price points.
    expect(errorsAfter((p) => (p.curve.liquidityWeights = [2, 1])).join()).to.include(
      "one entry per segment"
    );
    expect(errorsAfter((p) => (p.curve.sqrtPrices = [1, 1, 2])).join()).to.include(
      "strictly increasing"
    );

    // Escrow aimed somewhere else, or at nothing.
    expect(errorsAfter((p) => (p.escrow.protocol = "someone-else")).join()).to.include("escrow.protocol");
    expect(errorsAfter((p) => (p.escrow.bondLamports = 0)).join()).to.include("bondLamports");
    expect(errorsAfter((p) => (p.escrow.fundedBy = "treasury")).join()).to.include("escrow.fundedBy");

    // A migration target the escrow step cannot claim from.
    expect(errorsAfter((p) => (p.migration.migrationOption = "met_damm_v1")).join()).to.include(
      "migrationOption"
    );

    // The ordering rule, dropped.
    expect(
      errorsAfter((p) => (p.ordering.mustClaimTradingFeesBeforeMigration = false)).join()
    ).to.include("mustClaimTradingFeesBeforeMigration");
  });

  it("refuses a name it cannot load, including a traversal", () => {
    for (const bad of ["nope", "", "../launch-state", "a/b"]) {
      expect(() => presets.loadPreset(bad), bad).to.throw(/loadPreset/);
    }
  });

  it("reports every reason at once instead of the first", () => {
    const report = presets.validatePreset({
      name: "Bad Name",
      version: 0,
      curve: { sqrtPrices: [], liquidityWeights: [] },
    });

    expect(report.ok).to.equal(false);
    expect(report.errors.length).to.be.greaterThan(4);
    expect(report.errors.join()).to.include("name");
    expect(report.errors.join()).to.include("version");
  });
});
