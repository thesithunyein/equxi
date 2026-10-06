/**
 * Type declarations for `api/health.js`.
 *
 * Same shape as `api/markets.d.ts`: the module exports a callable function (the
 * Vercel handler). Health carries no helpers, so the namespace is only the
 * request and response shapes the handler reads.
 */

declare function health(req: health.Request, res: health.Response): Promise<void>;

declare namespace health {
  interface Request {
    method: string;
    query?: Record<string, string>;
  }

  interface Response {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  }
}

export = health;
