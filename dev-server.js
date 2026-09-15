#!/usr/bin/env node
/**
 * Local dev server — static files plus the read API.
 *
 * Vercel serves `api/*.js` as functions; nothing does that in a plain checkout,
 * which is why `explorer.html` cannot be tested by opening the file directly.
 * This shim closes that gap: it serves the repo as static files and dispatches
 * `/api/trust` to the real handler.
 *
 * It works because the handler uses only `req.method`, `req.query`, and the
 * standard `ServerResponse` surface — no vendor-specific glue — so a Node
 * `http` server satisfies it as-is. If it did not, that would be a design smell
 * worth fixing rather than papering over here.
 *
 * Usage:
 *   node dev-server.js            # http://localhost:4321
 *   node dev-server.js 3000       # custom port
 */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var { URL } = require("url");

var handler = require("./api/trust.js");

var ROOT = __dirname;
var PORT = Number(process.argv[2] || process.env.PORT || 4321);

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function serveStatic(res, pathname) {
  var relative = pathname === "/" ? "/index.html" : pathname;
  var target = path.resolve(ROOT, "." + relative);

  // Containment plus a blocklist: never escape the project, and never expose
  // dependency trees, build output, git metadata, or env files.
  var blocked = /(^|[\\/])(node_modules|target|\.git|\.vercel|\.well-known)([\\/]|$)/;
  if (!target.startsWith(ROOT) || blocked.test(relative) || /\.env/.test(relative)) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Not found: " + relative);
    return;
  }

  fs.readFile(target, function (error, data) {
    if (error) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Not found: " + relative);
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", MIME[path.extname(target).toLowerCase()] || "application/octet-stream");
    res.end(data);
  });
}

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, "http://localhost:" + PORT);

  if (url.pathname === "/api/trust") {
    // `req.query` is the one thing Vercel adds that Node does not, so the handler
    // only ever sees the shape it expects.
    var query = {};
    url.searchParams.forEach(function (value, key) {
      query[key] = value;
    });
    req.query = query;

    Promise.resolve(handler(req, res)).catch(function (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(error) }));
    });
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, function () {
  console.log("Equxi dev server: http://localhost:" + PORT);
  console.log("  Explorer:  http://localhost:" + PORT + "/explorer.html");
  console.log("  Read API:  http://localhost:" + PORT + "/api/trust");
});
