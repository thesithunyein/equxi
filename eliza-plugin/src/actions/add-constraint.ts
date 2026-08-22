/**
 * EQUXI_ADD_CONSTRAINT — Add on-chain behavioral rule for an agent.
 *
 * Supports: SpendLimit, ProgramAllowlist, TimeLock, VelocityLimit.
 */
import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { PublicKey } from "@solana/web3.js";
import { EquxiService, ConstraintType } from "../services/equxi-service.js";

export const addConstraintAction: Action = {
  name: "EQUXI_ADD_CONSTRAINT",
  description:
    "Add an on-chain behavioral constraint (spend limit, program allowlist, timelock, velocity limit) to an agent.",
  similes: ["ADD_CONSTRAINT", "ADD_RULE", "SET_LIMIT"],
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Set a 1 SOL daily spend limit for my agent" },
      },
      {
        user: "{{agent}}",
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
      description: "Type: SpendLimit, ProgramAllowlist, TimeLock, VelocityLimit",
      required: true,
      schema: { type: "string", enum: ["SpendLimit", "ProgramAllowlist", "TimeLock", "VelocityLimit"] },
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

      const owner = new PublicKey(walletKeyStr);
      const textContent = (message.content as any)?.text || "";

      const agentName =
        (message.content as any)?.agentName ||
        textContent.match(/for (\w+)/i)?.[1] ||
        "Agent";

      const typeStr =
        (message.content as any)?.constraintType || "SpendLimit";
      const constraintType =
        ConstraintType[typeStr as keyof typeof ConstraintType] ??
        ConstraintType.SpendLimit;

      // Parse max amount from text
      const amountMatch = textContent.match(/([\d.]+)\s*SOL/i);
      const maxAmount =
        (message.content as any)?.maxAmount ||
        (amountMatch ? Math.floor(parseFloat(amountMatch[1]) * 1e9) : 1_000_000_000);

      const lockDuration = (message.content as any)?.lockDuration || 0;

      // Get config for nonce
      const config = await service.getConfig();
      const totalBonds = config?.totalBonds || 0;

      const ix = await service.buildAddConstraint(
        owner,
        agentName,
        totalBonds,
        constraintType,
        maxAmount,
        [],
        lockDuration
      );

      const text = `${typeStr} constraint built for "${agentName}". Sign and send to enforce on-chain.`;

      await callback?.({ text });
      return {
        success: true,
        text,
        data: { instruction: ix, agentName, constraintType: typeStr, maxAmount },
      };
    } catch (err: any) {
      const text = `Failed to build constraint: ${err.message}`;
      await callback?.({ text });
      return { success: false, text };
    }
  },
};
