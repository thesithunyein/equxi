import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { EquxiService } from "../services/equxi-service.js";
export const slashBondAction = {
    name: "EQUXI_SLASH_BOND",
    description: "Slash an agent's bond for violating on-chain rules. Reduces bond and records violation.",
    similes: ["SLASH_BOND", "SLASH_AGENT", "PENALIZE"],
    examples: [
        [
            {
                name: "{{user1}}",
                content: { text: "Slash 0.1 SOL from my agent for exceeding spend limit" },
            },
            {
                name: "{{agent}}",
                content: { text: "Slashing bond..." },
            },
        ],
    ],
    parameters: [
        {
            name: "agentOwner",
            description: "Public key of the agent owner",
            required: true,
            schema: { type: "string" },
        },
        {
            name: "agentName",
            description: "Name of the agent to slash",
            required: true,
            schema: { type: "string" },
        },
        {
            name: "slashAmount",
            description: "Amount in SOL to slash",
            required: true,
            schema: { type: "number" },
        },
        {
            name: "reason",
            description: "Reason for slash (max 128 chars)",
            required: true,
            schema: { type: "string" },
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
            const authority = new PublicKey(walletKeyStr);
            const textContent = message.content?.text || "";
            const agentOwnerStr = message.content?.agentOwner ||
                runtime.getSetting("EQUXI_AGENT_OWNER") ||
                walletKeyStr;
            const agentOwner = new PublicKey(agentOwnerStr);
            const agentName = message.content?.agentName || "Agent";
            const slashAmountSol = message.content?.slashAmount ||
                parseFloat(textContent.match(/([\d.]+)\s*SOL/i)?.[1] || "0.1");
            const slashAmount = Math.floor(slashAmountSol * LAMPORTS_PER_SOL);
            const reason = message.content?.reason ||
                textContent.match(/for (.+)/i)?.[1] ||
                "Rule violation";
            const ix = await service.buildSlashBond(authority, agentOwner, agentName, slashAmount, reason);
            const text = `Slash instruction built: ${slashAmountSol} SOL from "${agentName}". Reason: ${reason}. Sign and send to execute.`;
            await callback?.({ text });
            return {
                success: true,
                text,
                data: {
                    instruction: ix,
                    agentName,
                    slashAmountSol,
                    reason,
                },
            };
        }
        catch (err) {
            const text = `Failed to build slash instruction: ${err.message}`;
            await callback?.({ text });
            return { success: false, text };
        }
    },
};
//# sourceMappingURL=slash-bond.js.map