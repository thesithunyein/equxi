/**
 * Type declarations for `api/badge.js`.
 *
 * Same shape as `trust.d.ts`: the runtime export is a callable handler that also
 * carries its helpers as properties, so a `function` declaration merged with a
 * `namespace` describes it exactly and makes the interfaces importable.
 */
import EquxiLayout = require("../lib/equxi-layout");
import trust = require("./trust");

declare function badge(req: badge.Request, res: badge.Response): Promise<void>;

declare namespace badge {
  interface RenderOptions {
    label?: string;
    value?: string;
    grade?: string;
  }

  interface BadgeAgent {
    address: string;
    name: string;
    grade: EquxiLayout.TrustGrade;
    score: number;
    onChainTrustScore: number;
    bondSol: number;
    slashCount: number;
    openSlashes: number;
    breakdown: EquxiLayout.TrustScoreEntry[];
    explorer: string;
  }

  interface BadgePayload {
    /** `graded` when an agent exists, `unknown` when the address has none. */
    status: "graded" | "unknown";
    label: string;
    value: string;
    grade: string;
    reason: string | null;
    generatedAt: number;
    cluster: string;
    agent: BadgeAgent | null;
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

  /** Pure SVG renderer, so the markup can be asserted without a network. */
  function renderBadge(options: RenderOptions): string;

  function buildBadge(
    query: { agent?: string; cluster?: string; rpc?: string; label?: string },
    deps: trust.BuildResponseDeps
  ): Promise<BadgePayload>;

  function textWidth(text: string): number;
}

export = badge;
