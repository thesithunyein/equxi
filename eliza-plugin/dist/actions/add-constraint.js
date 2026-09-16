import { PublicKey } from "@solana/web3.js";
import { EquxiService, ConstraintType, MAX_CONSTRAINTS } from "../services/equxi-service.js";
export const addConstraintAction = {
    name: "EQUXI_ADD_CONSTRAINT",
    description: "Add an on-chain behavioral constraint (spend limit, program allowlist, timelock, velocity limit) to an agent.",
    similes: ["ADD_CONSTRAINT", "ADD_RULE", "SET_LIMIT"],
    examples: [
        [
            {
                name: "{{user1}}",
                content: { text: "Set a 1 SOL daily spend limit for my agent" },
            },
            {
                name: "{{agent}}",
                content: { text: "Adding spend limit constraint..." },
            },
        ],
    ],
    parameters: [
        {
            name: "agentName",
            description: "Name of the agent to constrain",
            required: true,
            schema: { type: "string" },
        },
        {
            name: "constraintType",
            description: "Type: SpendLimit, ProgramAllowlist, Timelock, Velocity, Custom",
            required: true,
            schema: {
                type: "string",
                enum: ["SpendLimit", "ProgramAllowlist", "Timelock", "Velocity", "Custom"],
            },
        },
        {
            name: "maxAmount",
            description: "Max amount in lamports (for SpendLimit/VelocityLimit)",
            required: false,
            schema: { type: "number" },
        },
        {
            name: "lockDuration",
            description: "Lock duration in seconds (for TimeLock)",
            required: false,
            schema: { type: "number" },
        },
    ],
    validate: async (_runtime) => {
        return true;
    },
    handler: async (runtime, message, _state, _options, callback) => {
        const service = new EquxiService(runtime);
        try {
            const walletKeyStr = runtime.getSetting("WALLET_PUBLIC_KEY");
            if (!walletKeyStr) {
                const text = "No wallet configured. Set WALLET_PUBLIC_KEY in your elizaOS config.";
                await callback?.({ text });
                return { success: false, text };
            }
            const owner = new PublicKey(walletKeyStr);
            const textContent = message.content?.text || "";
            const agentName = message.content?.agentName ||
                textContent.match(/for (\w+)/i)?.[1] ||
                "Agent";
            const typeStr = message.content?.constraintType || "SpendLimit";
            const constraintType = ConstraintType[typeStr] ??
                ConstraintType.SpendLimit;
            // Parse max amount from text
            const amountMatch = textContent.match(/([\d.]+)\s*SOL/i);
            const maxAmount = message.content?.maxAmount ||
                (amountMatch ? Math.floor(parseFloat(amountMatch[1]) * 1e9) : 1_000_000_000);
            const lockDuration = message.content?.lockDuration || 0;
            // The constraint PDA is seeded on the agent's own constraint counter, so
            // read the agent to find the next free index. Each agent may hold up to 16.
            const agent = await service.getAgent(owner, agentName);
            if (agent && agent.constraintCount >= MAX_CONSTRAINTS) {
                const text = `"${agentName}" already has the maximum of ${MAX_CONSTRAINTS} rules.`;
                await callback?.({ text });
                return { success: false, text };
            }
            const constraintIndex = agent ? agent.constraintCount : 0;
            const periodSeconds = message.content?.periodSeconds || 86400;
            const allowedPrograms = message.content?.allowedPrograms || [];
            const ix = await service.buildAddConstraint(owner, agentName, constraintIndex, constraintType, {
                maxAmount,
                maxPerPeriod: maxAmount * 5,
                periodSeconds,
                timelockSeconds: lockDuration,
                allowedPrograms: allowedPrograms.map((p) => new PublicKey(p)),
            });
            const text = `${typeStr} constraint built for "${agentName}". Sign and send to enforce on-chain.`;
            await callback?.({ text });
            return {
                success: true,
                text,
                data: { instruction: ix, agentName, constraintType: typeStr, maxAmount },
            };
        }
        catch (err) {
            const text = `Failed to build constraint: ${err.message}`;
            await callback?.({ text });
            return { success: false, text };
        }
    },
};
//# sourceMappingURL=add-constraint.js.map