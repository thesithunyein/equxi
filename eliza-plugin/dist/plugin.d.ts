/**
 * @equxi/plugin-eliza — On-chain guardrails for Solana AI agents.
 *
 * Provides spend limits, timelocks, and bond enforcement via the Equxi
 * Anchor program on Solana devnet/mainnet.
 */
import type { Plugin } from "@elizaos/core";
export declare const EQUXI_PLUGIN_NAME = "@equxi/plugin-eliza";
export declare const equxiPlugin: Plugin;
export default equxiPlugin;
export { EquxiService } from "./services/equxi-service.js";
export { registerAgentAction } from "./actions/register-agent.js";
export { lockBondAction } from "./actions/lock-bond.js";
export { addConstraintAction } from "./actions/add-constraint.js";
export { slashBondAction } from "./actions/slash-bond.js";
//# sourceMappingURL=plugin.d.ts.map