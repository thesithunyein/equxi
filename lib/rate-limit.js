/**
 * Best-effort request throttle for the public read APIs.
 *
 * Three honest caveats, because a throttle that overstates itself is worse than
 * none:
 *
 * * **Per instance.** A serverless platform fans out; each instance keeps its
 *   own budget. This blunts a client that hammers one instance, it does not
 *   promise a global ceiling.
 * * **In memory.** A cold start resets it. Nothing is stored anywhere.
 * * **Not the primary defense.** That is the CDN cache in front of these
 *   endpoints (`s-maxage` + `stale-while-revalidate`), which answers repeat
 *   readers without this code running at all.
 *
 * What it does cover is the case the cache cannot help with: a client that
 * puts a different query string on every request, so nothing is ever a cache
 * hit and every call reaches a whole-program scan.
 *
 * Fail-open by design — if anything in here throws, the request is allowed. A
 * busier-than-expected afternoon must never turn into a 429 for a judge.
 */
"use strict";

/** One window, measured from the first request each client makes. */
var WINDOW_MS = 60 * 1000;

/**
 * Requests allowed per client per window. Deliberately far above what a person
 * or a badge embed generates; a page load makes one or two calls, not dozens.
 */
var MAX_PER_WINDOW = 120;

var hits = {};
var lastSweep = 0;

/** The client address, as far as the platform's proxy headers admit. */
function clientIp(req) {
  var headers = (req && req.headers) || {};
  var forwarded = headers["x-forwarded-for"] || headers["x-real-ip"];
  if (typeof forwarded === "string" && forwarded) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0]).split(",")[0].trim();
  }
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

/** Drop expired entries so the map cannot grow without bound. */
function sweep(now) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  Object.keys(hits).forEach(function (key) {
    if (hits[key].resetAt <= now) delete hits[key];
  });
}

/** True when this request should be refused. Never throws. */
function limited(req) {
  try {
    var now = Date.now();
    var ip = clientIp(req);
    var entry = hits[ip];
    if (!entry || entry.resetAt <= now) {
      entry = hits[ip] = { count: 0, resetAt: now + WINDOW_MS };
    }
    entry.count += 1;
    sweep(now);
    return entry.count > MAX_PER_WINDOW;
  } catch (error) {
    return false;
  }
}

module.exports = {
  limited: limited,
  clientIp: clientIp,
  WINDOW_MS: WINDOW_MS,
  MAX_PER_WINDOW: MAX_PER_WINDOW,
};
