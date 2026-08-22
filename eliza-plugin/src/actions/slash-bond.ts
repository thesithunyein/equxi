/**
 * EQUXI_SLASH_BOND — Slash an agent's bond for rule violation.
 *
 * Only the config admin can execute slashes. Reduces bond amount and records violation.
 */
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { EquxiService } from "../services/equxi-service.js";

export const slashBondAction: Action = {
  name: "EQUXI_SLASH_BOND",
  description:
    "Slash an agent's bond for violating on-chain rules. Reduces bond and records violation.",
  similes: ["SLASH_BOND", "SLASH_AGENT", "PENALIZE"],
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Slash 0.1 SOL from my agent for exceeding spend limit" },
      },
      {
        user: "{{agent}}",
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
  validate: async (_runtime: IAgentRuntime): Promise<boolean> => {
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const service = new EquxiService(runtime);

    try {
      const walletKeyStr = runtime.getSetting("WALLET_PUBLIC_KEY");
      if (!walletKeyStr) {
        const text = "No wallet configured. Set WALLET_PUBLIC_KEY in your elizaOS config.";
        await callback?.({ text });
        return { success: false, text };
      }

      const authority = new PublicKey(walletKeyStr);
      const textContent = (message.content as any)?.text || "";

      const agentOwnerStr =
        (message.content as any)?.agentOwner ||
        runtime.getSetting("EQUXI_AGENT_OWNER") ||
        walletKeyStr;
      const agentOwner = new PublicKey(agentOwnerStr);

      const agentName =
        (message.content as any)?.agentName || "Agent";

      const slashAmountSol =
        (message.content as any)?.slashAmount ||
        parseFloat(textContent.match(/([\d.]+)\s*SOL/i)?.[1] || "0.1");
      const slashAmount = Math.floor(slashAmountSol * LAMPORTS_PER_SOL);

      const reason =
        (message.content as any)?.reason ||
        textContent.match(/for (.+)/i)?.[1] ||
        "Rule violation";

      const ix = await service.buildSlashBond(
        authority,
        agentOwner,
        agentName,
        slashAmount,
        reason
      );

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
    } catch (err: any) {
      const text = `Failed to build slash instruction: ${err.message}`;
      await callback?.({ text });
      return { success: false, text };
    }
  },
};
