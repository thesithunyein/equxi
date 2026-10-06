/**
 * Type declarations for `lib/rate-limit.js`.
 *
 * A per-instance, in-memory throttle shared by the public read APIs. The
 * surface is deliberately narrow: the handlers need to ask whether a request is
 * over budget, and to know the window and the ceiling so they can set
 * `Retry-After` and describe themselves honestly.
 *
 * What it is not: a global ceiling. A serverless platform fans out, so each
 * instance keeps its own count, and the CDN cache in front of these endpoints
 * is what actually answers repeat readers. See the module for the full caveat.
 */
declare namespace rateLimit {
  /** Just enough of the platform's request shape to key a caller. */
  interface Request {
    headers?: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
  }

  /** True when this request should be refused. Never throws, never blocks. */
  function limited(req: Request | null | undefined): boolean;

  /** The client address, as far as the proxy headers admit. */
  function clientIp(req: Request | null | undefined): string;

  /** Window length in milliseconds. */
  const WINDOW_MS: number;

  /** Requests allowed per client per window. */
  const MAX_PER_WINDOW: number;
}

export = rateLimit;
