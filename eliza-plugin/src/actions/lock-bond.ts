/**
 * EQUXI_LOCK_BOND — Lock SOL as a safety bond for an agent.
 *
 * Transfers SOL from the operator to a PDA-secured bond account.
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

export const lockBondAction: Action = {
  name: "EQUXI_LOCK_BOND",
  description:
    "Lock SOL as a safety bond for an agent on Equxi. Bond can be slashed if agent violates rules.",
  similes: ["LOCK_BOND", "STAKE_BOND", "CREATE_BOND"],
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Lock 0.5 SOL as bond for my trading bot" },
      },
      {
        user: "{{agent}}",
        content: { text: "Locking 0.5 SOL bond for your agent..." },
      },
    ],
  ],
  parameters: [
    {
      name: "agentName",
      description: "Name of the agent to bond",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "amount",
      description: "Amount in SOL to lock as bond",
      required: true,
      schema: { type: "number" },
    },
    {
      name: "lockDuration",
      description: "Lock duration in seconds (default: 86400 = 1 day)",
      required: false,
      schema: { type: "number" },
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

      const operator = new PublicKey(walletKeyStr);

      // Parse amount
      const textContent = (message.content as any)?.text || "";
      const amountMatch = textContent.match(/([\d.]+)\s*SOL/i);
      const amountSol = amountMatch
        ? parseFloat(amountMatch[1])
        : (message.content as any)?.amount || 0.5;
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      const agentName =
        (message.content as any)?.agentName ||
        textContent.match(/for (\w+)/i)?.[1] ||
        "Agent";

      const lockDuration =
        (message.content as any)?.lockDuration || 86400; // 1 day default

      if (amountLamports < 100_000_000) {
        const msg2 = "Minimum bond is 0.1 SOL (100,000,000 lamports).";
        await callback?.({ text: msg2 });
        return { success: false, text: msg2 };
      }

      const ix = await service.buildLockBond(
        operator,
        agentName,
        amountLamports,
        lockDuration
      );

      const text = `Bond instruction built: ${amountSol} SOL locked for "${agentName}" (${lockDuration}s lock). Sign and send to complete.`;

      await callback?.({ text });
      return {
        success: true,
        text,
        data: { instruction: ix, agentName, amountSol, lockDuration },
      };
    } catch (err: any) {
      const text = `Failed to build bond instruction: ${err.message}`;
      await callback?.({ text });
      return { success: false, text };
    }
  },
};
