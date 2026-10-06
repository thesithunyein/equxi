/**
 * One structured log line per API request.
 *
 * The read APIs had no way to answer "is this deployment actually being used,
 * and is it healthy?" short of reading the platform's raw request log, which
 * does not carry the status or the timing. This emits one JSON object per
 * request to stdout, which is where a serverless platform keeps its logs and
 * what a log drain ships somewhere central. That is the whole design: no
 * vendor, no SDK, no background job, and nothing that can fail a request.
 *
 * Why stdout and not a metrics service: this project has no dependencies by
 * design (`vercel.json` sets `"buildCommand": null`), and a hosted platform's
 * log pipeline *is* the observability layer. `GET /api/health` covers the
 * liveness half of the question; these lines cover the usage and latency half.
 *
 * ## What is in a line
 *
 * | Field | Meaning |
 * |-------|---------|
 * | `at` | ISO timestamp |
 * | `route` | Which endpoint (`trust`, `markets`, `badge`, `health`) |
 * | `method` | HTTP method |
 * | `status` | Response status |
 * | `ms` | Wall time from handler entry to the response being written |
 * | `cluster` / `target` | The cluster asked for, and the address asked about, if any |
 *
 * ## The rule it follows
 *
 * **Logging can never change an answer.** Everything is wrapped: a missing
 * `console`, a frozen `res`, or a circular value costs a log line, not a
 * response. It is also off outside a deployment unless `EQUXI_LOG=1` is set,
 * so the unit suite and a local run stay quiet.
 */
"use strict";

/** Truncate a field that is safe to log but not worth logging in full. */
function clip(value, keep) {
  return String(value).slice(0, keep);
}

/** Is this somewhere logs are actually collected? */
function enabled() {
  if (process.env.EQUXI_LOG === "0") return false;
  return !!(process.env.VERCEL || process.env.VERCEL_ENV) || process.env.EQUXI_LOG === "1";
}

/** Write one line. Never throws. */
function emit(route, req, status, ms) {
  try {
    var query = (req && req.query) || {};
    var line = {
      at: new Date().toISOString(),
      service: "equxi",
      route: route,
      method: (req && req.method) || "GET",
      status: status,
      ms: ms,
    };
    if (query.cluster) line.cluster = clip(query.cluster, 24);
    // Exactly one of these is ever set; both are already public addresses.
    if (query.agent) line.target = clip(query.agent, 44);
    else if (query.owner) line.target = clip(query.owner, 44);
    console.log(JSON.stringify(line));
  } catch (error) {
    /* A log line is never worth failing a request over. */
  }
}

/**
 * Wrap `res.end` so the status and the duration are logged once, when the
 * response is actually written. Every handler calls this at the top, which is
 * why it takes the `route` name rather than being inferred.
 */
function track(route, req, res) {
  try {
    if (!enabled() || !res || typeof res.end !== "function") return;
    var started = Date.now();
    var done = false;
    var originalEnd = res.end;
    res.end = function () {
      if (!done) {
        done = true;
        emit(route, req, res.statusCode, Date.now() - started);
      }
      return originalEnd.apply(res, arguments);
    };
  } catch (error) {
    /* Never fail a request because a log line could not be attached. */
  }
}

module.exports = { track: track, enabled: enabled };
