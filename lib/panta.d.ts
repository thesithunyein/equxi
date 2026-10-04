/**
 * Type declarations for `lib/panta.js` (the dependency-free Panta flow client).
 *
 * Same shape as the other declarations in this repo: a namespace merged with
 * the default export, so interfaces are importable as `panta.OrderBuild`, etc.
 */

declare namespace panta {
  /** Just enough of the Fetch API for the upstream call to be driven from a stub. */
  type FetchImpl = (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: unknown;
    }
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

  const PANTA_BASE: string;
  /** Categories Panta accepts for market creation. */
  const CATEGORIES: string[];
  const MIN_START_DELAY_SECONDS: number;

  /** Thrown for any failure; keeps Panta's `code` and the HTTP `status`. */
  function PantaError(
    code: string,
    message?: string,
    status?: number,
    fields?: unknown
  ): Error & { name: string; code: string; status: number; fields?: unknown };

  interface MarketCreateParams {
    wallet: string;
    question: string;
    resolutionRule: string;
    sourcesOfTruth: string[];
    category: string;
    startTime: number;
    endTime: number;
    resolutionTime: number;
    marketType?: "standard" | "breaking";
    title?: string;
    description?: string;
    /** Required by Panta: a publicly reachable catalog image URL. */
    imageUrl: string;
    region?: string;
  }

  interface MarketQuote {
    createId: string;
    expectedEventPda: string;
    /** USDC base units (6 decimals), integer strings. */
    paymentUsdc: string;
    liquidityInjectionUsdc: string;
    platformRevenueUsdc: string;
    marketType: string;
    expiresAt: string;
    blockhashExpiryHintSec: number;
  }

  interface MarketBuild {
    createId: string;
    expectedEventPda: string;
    /** Base64 unsigned VersionedTransaction: decode, sign, broadcast. */
    transaction: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
    buildFingerprint: string;
  }

  interface MarketRegistration {
    createId: string;
    marketId: string;
    status: string;
    signature: string;
    category: string;
    title: string;
    images: string[];
  }

  interface OrderQuote {
    quoteId: string;
    marketId: string;
    side: string;
    /** Human-readable decimal USDC strings on this route. */
    amountUsdc: string;
    shares: string;
    avgPrice: string;
    feeUsdc: string;
    expiresAt: string;
    blockhashExpiryHintSec: number;
  }

  interface OrderInstruction {
    programId: string;
    data: string;
    accounts: Array<{ pubkey: string; isSigner?: boolean; isWritable?: boolean }>;
  }

  interface OrderBuild {
    orderId: string;
    quoteId: string;
    wallet: string;
    marketId: string;
    side: string;
    amountUsdc: string;
    expectedShares: string;
    feeUsdc: string;
    status: string;
    instructions: OrderInstruction[];
    recentBlockhash: string;
    lastValidBlockHeight: number;
    expiresAt: string;
  }

  interface AgentMarketPlan {
    question: string;
    title: string;
    description: string;
    resolutionRule: string;
    sourcesOfTruth: string[];
    category: string;
    startTime: number;
    endTime: number;
    resolutionTime: number;
    marketType: "standard";
    region: string;
  }

  function quoteMarketCreate(f: FetchImpl, apiKey: string, params: MarketCreateParams): Promise<MarketQuote>;
  function buildMarketCreate(f: FetchImpl, apiKey: string, body: { createId: string; wallet: string }): Promise<MarketBuild>;
  function registerMarket(f: FetchImpl, apiKey: string, body: { createId: string; signature: string }): Promise<MarketRegistration>;

  function quotePrimaryBuy(
    f: FetchImpl,
    apiKey: string,
    body: { wallet: string; marketId: string; side: string; amountUsdc: string; userId?: string }
  ): Promise<OrderQuote>;
  function buildPrimaryBuy(
    f: FetchImpl,
    apiKey: string,
    body: { quoteId: string; wallet: string; userId?: string; maxSlippageBps?: number }
  ): Promise<OrderBuild>;
  function submitPrimaryBuy(
    f: FetchImpl,
    apiKey: string,
    body: { orderId: string; signature: string; wallet?: string }
  ): Promise<{ orderId: string; status: string; signature: string }>;
  function reportTrade(
    f: FetchImpl,
    apiKey: string,
    body: {
      signature: string;
      wallet: string;
      marketId: string;
      quoteId?: string;
      clientOrderId?: string;
      userId?: string;
    }
  ): Promise<{ signature: string; status: string; marketId: string; wallet: string; side?: string; kind: string }>;

  function agentMarketPlan(input: {
    now: number;
    resolveBy: number;
    resolveByLabel: string;
    agentAddress: string;
    agentName?: string;
    category?: string;
    programId?: string;
    site?: string;
    region?: string;
  }): AgentMarketPlan;
}

export = panta;
