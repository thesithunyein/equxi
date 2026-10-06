/**
 * Type declarations for `api/markets.js`.
 *
 * Same shape as `api/trust.d.ts`: at runtime the module exports a callable
 * function (the Vercel handler) that also carries its helpers as properties. A
 * `function` declaration merged with a `namespace` describes exactly that, and
 * makes the interfaces importable as `markets.ApiPayload`, and so on.
 *
 * The endpoint answers three documented Panta reads, so `ApiPayload` is the
 * union of their three payloads and `mode` is the discriminant:
 *
 *   mode "list"      <- GET /markets/
 *   mode "market"    <- GET /markets/{marketId}/
 *   mode "positions" <- GET /positions/?wallet=
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
      positions?: markets.PantaPosition[];
      nextCursor?: string | null;
      /** Echoed by the positions route. */
      wallet?: string;
      /** Present on the market-detail route; the list route nests items instead. */
      marketId?: string;
      yesPrice?: string | null;
      noPrice?: string | null;
      primaryYesPrice?: string | null;
      primaryNoPrice?: string | null;
      secondaryYesPrice?: string | null;
      secondaryNoPrice?: string | null;
      /** Present on every Panta mode; test mode says the data is sandboxed. */
      disclaimer?: string;
      error?: string;
      code?: string;
    }>;
  }>;

  /**
   * Query params, plus the limit clamp rules. `market` and `wallet` select the
   * detail and positions modes; the rest are forwarded to Panta's list route.
   */
  interface Query {
    category?: string;
    status?: string;
    createdBy?: string;
    cursor?: string;
    limit?: string;
    /** Read one market's detail (with the spot prices the list omits). */
    market?: string;
    /** Read one wallet's positions (with claim eligibility). */
    wallet?: string;
  }

  /**
   * One market as Panta's `GET /markets/` returns it. Prices are `null` on the
   * list route and filled in on the detail route, which `?market=` calls.
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
    /** Detail-route-only prices. Absent on a list row. */
    primaryYesPrice?: string | null;
    primaryNoPrice?: string | null;
    secondaryYesPrice?: string | null;
    secondaryNoPrice?: string | null;
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

  /**
   * One position row as Panta's `GET /positions/` returns it. A holding with
   * both YES and NO shares comes back as two rows (one per `side`) — Panta
   * documents that as expected, not a duplicate.
   */
  interface PantaPosition {
    marketId: string;
    category?: string | null;
    side?: "yes" | "no" | string;
    shares?: string;
    phase?: "primary" | "secondary" | "resolved" | "cancelled" | string;
    /** Claim construction is allowed for this side. */
    claimable?: boolean;
    /** A claim account already exists. */
    claimed?: boolean;
    /** `yes` / `no` after resolution; otherwise `null`. */
    outcome?: string | null;
  }

  /** The normalized position shape: the fields a caller can act on, nothing more. */
  interface NormalizedPosition {
    marketId: string;
    category?: string | null;
    side?: string;
    shares?: string;
    phase?: string;
    claimable?: boolean;
    claimed?: boolean;
    outcome?: string | null;
  }

  /** Spot prices from the detail route. Every field is `null` until RPC fills it. */
  interface MarketPrices {
    yes: string | null;
    no: string | null;
    primaryYes: string | null;
    primaryNo: string | null;
    secondaryYes: string | null;
    secondaryNo: string | null;
  }

  /** Fields every mode carries, including the unconfigured answer. */
  interface BasePayload {
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
    /** Which Panta read answered this request. */
    mode: "list" | "market" | "positions";
    generatedAt: number;
    note?: string;
    /** Panta's own wording for the current mode, passed through verbatim. */
    disclaimer?: string | null;
  }

  interface ListPayload extends BasePayload {
    mode: "list";
    counts: { markets: number };
    nextCursor: string | null;
    markets: NormalizedMarket[];
  }

  interface MarketPayload extends BasePayload {
    mode: "market";
    market: NormalizedMarket | null;
    prices: MarketPrices | null;
  }

  interface PositionsPayload extends BasePayload {
    mode: "positions";
    wallet: string | null;
    counts: { positions: number };
    positions: NormalizedPosition[];
  }

  type ApiPayload = ListPayload | MarketPayload | PositionsPayload;

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

  /** Drop a position row down to the documented fields. */
  function normalizePosition(item: PantaPosition): NormalizedPosition;

  /** Build the upstream URL, enforcing the limit clamp. Throws 400 on a bad limit. */
  function pantaUrl(query: Query): string;

  /** `GET /markets/{marketId}/` — the detail route with spot prices. */
  function marketDetailUrl(marketId: string): string;

  /** `GET /positions/?wallet=` — holdings with claim eligibility. */
  function positionsUrl(wallet: string): string;

  /** Panta error code -> the HTTP status this API answers with. */
  function statusForCode(code: string): number;
}

export = markets;
