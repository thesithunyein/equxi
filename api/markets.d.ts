/**
 * Type declarations for `api/markets.js`.
 *
 * Same shape as `api/trust.d.ts`: at runtime the module exports a callable
 * function (the Vercel handler) that also carries its helpers as properties. A
 * `function` declaration merged with a `namespace` describes exactly that, and
 * makes the interfaces importable as `markets.ApiPayload`, and so on.
 */

declare function markets(req: markets.Request, res: markets.Response): Promise<void>;

declare namespace markets {
  /** Just enough of the Fetch API for the upstream call to be driven from a stub. */
  type FetchImpl = (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      signal?: unknown;
    }
  ) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<{
      items?: markets.PantaMarket[];
      nextCursor?: string | null;
      /** Present on every Panta mode; test mode says the data is sandboxed. */
      disclaimer?: string;
      error?: string;
      code?: string;
    }>;
  }>;

  /** Query params forwarded to Panta, plus the limit clamp rules. */
  interface Query {
    category?: string;
    status?: string;
    createdBy?: string;
    cursor?: string;
    limit?: string;
  }

  /**
   * One market as Panta's `GET /markets/` returns it. Prices are `null` on the
   * list route and filled in on the detail route, which this API does not call.
   */
  interface PantaMarket {
    marketId: string;
    title?: string;
    description?: string;
    category?: string;
    marketType?: string;
    phase?: "primary" | "secondary" | "resolved" | "cancelled" | string;
    resolved?: boolean;
    status?: string;
    startTime?: string;
    endTime?: string;
    resolutionTime?: string;
    region?: string;
    volumeUsdc?: string | number;
    yesPrice?: string | null;
    noPrice?: string | null;
    campaignId?: string | null;
    createdByPartner?: boolean;
    images?: string[];
  }

  /** The normalized shipping shape: same fields, no vendor extras. */
  interface NormalizedMarket {
    marketId: string;
    title?: string;
    description?: string;
    category?: string;
    marketType?: string;
    phase?: string;
    resolved?: boolean;
    status?: string;
    startTime?: string;
    endTime?: string;
    resolutionTime?: string;
    region?: string;
    volumeUsdc?: string | number;
    yesPrice?: string | null;
    noPrice?: string | null;
    campaignId?: string | null;
    createdByPartner?: boolean;
    images?: string[];
  }

  interface ApiPayload {
    ok: true;
    /** False when `PANTA_API_KEY` is unset: the feed is off, and says so. */
    configured: boolean;
    /**
     * True when the configured key is a `pk_test_…` key. Panta answers those
     * with fixtures that never touch Solana mainnet, so the Explorer labels
     * them instead of presenting them as live markets.
     */
    sandbox: boolean;
    source: "panta";
    /** Required by Panta's Terms of Use wherever the feed appears. */
    attribution: string;
    /** Panta's live API base URL, so a reader can verify the provenance. */
    base: string;
    generatedAt: number;
    note?: string;
    /** Panta's own wording for the current mode, passed through verbatim. */
    disclaimer?: string | null;
    counts: { markets: number };
    nextCursor: string | null;
    markets: NormalizedMarket[];
  }

  interface BuildResponseDeps {
    fetchImpl: FetchImpl;
    now: number;
    apiKey?: string;
  }

  interface Request {
    method: string;
    query?: Record<string, string>;
  }

  interface Response {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  }

  function buildResponse(query: Query, deps: BuildResponseDeps): Promise<ApiPayload>;

  function normalizeMarket(item: PantaMarket): NormalizedMarket;

  /** Build the upstream URL, enforcing the limit clamp. Throws 400 on a bad limit. */
  function pantaUrl(query: Query): string;
}

export = markets;
