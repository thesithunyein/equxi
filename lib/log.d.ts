/**
 * Type declarations for `lib/log.js`.
 *
 * A single structured line per API request, written to stdout for the
 * platform's log pipeline. The surface is deliberately two functions:
 * `track` attaches the log to a response, `enabled` answers whether this
 * environment logs at all.
 */
declare namespace log {
  /** Just enough of the platform's request shape to describe one request. */
  interface Request {
    method?: string;
    query?: Record<string, string>;
  }

  /** Just enough of the response to read a status and wrap `end`. */
  interface Response {
    statusCode: number;
    end: (body?: string) => unknown;
  }

  /** Log this response once, when it is written. Never throws, never blocks. */
  function track(route: string, req?: Request | null, res?: Response | null): void;

  /** True when this environment collects logs. */
  function enabled(): boolean;
}

export = log;
