/**
 * EQUXI_REGISTER_AGENT — Register a new AI agent on-chain.
 *
 * Creates an on-chain identity for the agent with operator ownership.
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
import { EquxiService, AgentType } from "../services/equxi-service.js";

export const registerAgentAction: Action = {
  name: "EQUXI_REGISTER_AGENT",
  description:
    "Register a new AI agent on Solana via Equxi. Creates on-chain identity with operator ownership.",
  similes: ["REGISTER_AGENT", "CREATE_AGENT", "NEW_AGENT"],
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Register my trading bot as an agent on Equxi" },
      },
      {
        user: "{{agent}}",
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
      description: "Agent type: Trader, Executor, Analyst, Custom",
      required: false,
      schema: { type: "string", enum: ["Trader", "Executor", "Analyst", "Custom"] },
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

    // Extract params from message
    const name =
      (message.content as any)?.name ||
      (message.content as any)?.text?.match(/agent named? (\w+)/i)?.[1] ||
      "Agent";

    const typeStr =
      (message.content as any)?.agentType || "Trader";
    const agentType =
      AgentType[typeStr as keyof typeof AgentType] ?? AgentType.Trader;

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
    } catch (err: any) {
      const text = `Failed to build register instruction: ${err.message}`;
      await callback?.({ text });
      return { success: false, text };
    }
  },
};
