import { registerAgentAction } from "./actions/register-agent.js";
import { lockBondAction } from "./actions/lock-bond.js";
import { addConstraintAction } from "./actions/add-constraint.js";
import { slashBondAction } from "./actions/slash-bond.js";
import { EquxiService } from "./services/equxi-service.js";
export const EQUXI_PLUGIN_NAME = "@equxi/plugin-eliza";
export const equxiPlugin = {
    name: EQUXI_PLUGIN_NAME,
    description: "On-chain guardrails for Solana AI agents: spend limits, timelocks, bond enforcement, and slash via Equxi program.",
    actions: [
        registerAgentAction,
        lockBondAction,
        addConstraintAction,
        slashBondAction,
    ],
    services: [EquxiService],
};
export default equxiPlugin;
// Re-export for direct import
export { EquxiService } from "./services/equxi-service.js";
export { registerAgentAction } from "./actions/register-agent.js";
export { lockBondAction } from "./actions/lock-bond.js";
export { addConstraintAction } from "./actions/add-constraint.js";
export { slashBondAction } from "./actions/slash-bond.js";
//# sourceMappingURL=plugin.js.map