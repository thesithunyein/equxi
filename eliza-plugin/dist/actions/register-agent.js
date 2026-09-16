import { PublicKey } from "@solana/web3.js";
import { EquxiService, AgentType } from "../services/equxi-service.js";
export const registerAgentAction = {
    name: "EQUXI_REGISTER_AGENT",
    description: "Register a new AI agent on Solana via Equxi. Creates on-chain identity with operator ownership.",
    similes: ["REGISTER_AGENT", "CREATE_AGENT", "NEW_AGENT"],
    examples: [
        [
            {
                name: "{{user1}}",
                content: { text: "Register my trading bot as an agent on Equxi" },
            },
            {
                name: "{{agent}}",
                content: { text: "Registering your agent on Equxi..." },
            },
        ],
    ],
    parameters: [
        {
            name: "name",
            description: "Agent name (max 32 chars)",
            required: true,
            schema: { type: "string" },
        },
        {
            name: "agentType",
            description: "Agent type: Trader, Oracle, DeFi, Payment, NFT, Governance, Bridge, Custom",
            required: false,
            schema: {
                type: "string",
                enum: [
                    "Trader",
                    "Oracle",
                    "DeFi",
                    "Payment",
                    "NFT",
                    "Governance",
                    "Bridge",
                    "Custom",
                ],
            },
        },
    ],
    validate: async (_runtime) => {
        return true;
    },
    handler: async (runtime, message, _state, _options, callback) => {
        const service = new EquxiService(runtime);
        // Extract params from message
        const name = message.content?.name ||
            message.content?.text?.match(/agent named? (\w+)/i)?.[1] ||
            "Agent";
        const typeStr = message.content?.agentType || "Trader";
        const agentType = AgentType[typeStr] ?? AgentType.Trader;
        try {
            // Get wallet from runtime
            const walletKeyStr = runtime.getSetting("WALLET_PUBLIC_KEY");
            if (!walletKeyStr) {
                const text = "No wallet configured. Set WALLET_PUBLIC_KEY in your elizaOS config.";
                await callback?.({ text });
                return { success: false, text };
            }
            const operator = new PublicKey(walletKeyStr);
            const ix = await service.buildRegisterAgent(operator, name, agentType);
            const text = `Agent "${name}" register instruction built. Sign and send this transaction to register on Solana devnet.\n\nProgram: ${service.programId.toBase58()}\nOperator: ${operator.toBase58()}`;
            await callback?.({ text });
            return { success: true, text, data: { instruction: ix, name, agentType: typeStr } };
        }
        catch (err) {
            const text = `Failed to build register instruction: ${err.message}`;
            await callback?.({ text });
            return { success: false, text };
        }
    },
};
//# sourceMappingURL=register-agent.js.map