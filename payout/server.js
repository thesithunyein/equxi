"use strict";

const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { timingSafeEqual } = require("node:crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { openStore, check } = require("./store");

const origin = new URL(process.env.PAYOUT_ORIGIN || "http://localhost:4322").origin;
const { PAYOUT_OPERATOR_TOKEN: operator, PAYOUT_AGENT_TOKEN: agent } = process.env;
check(operator?.length >= 32 && agent?.length >= 32 && operator !== agent,
  "Set two distinct tokens of at least 32 characters.");
const store = openStore(process.env.PAYOUT_DB || "payout.sqlite", {
  origin,
  agentWallet: process.env.PAYOUT_AGENT_WALLET,
  mint: process.env.PAYOUT_MINT,
  maxAmountRaw: process.env.PAYOUT_LIMIT_RAW,
});
const files = {
  "/": ["page.html", "text/html; charset=utf-8"],
  "/client.js": ["client.js", "text/javascript; charset=utf-8"],
  "/payout.css": ["payout.css", "text/css; charset=utf-8"],
};

function authorized(req, token) {
  const actual = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from("Bearer " + token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function reply(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req) {
  check(req.headers["content-type"]?.split(";")[0] === "application/json", "Expected JSON.", 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    check(length <= 16384, "Request too large.", 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks));
    check(data && typeof data === "object" && !Array.isArray(data), "Expected a JSON object.");
    return data;
  } catch {
    check(false, "Invalid JSON object.");
  }
}

function result(action) {
  try {
    return { content: [{ type: "text", text: JSON.stringify(action()) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.status ? error.message : "Payout operation failed." }] };
  }
}

async function handleMcp(req, res) {
  check(authorized(req, agent), "Agent token required.", 401);
  check(req.method === "POST", "Use POST.", 405);
  const data = await body(req);
  const server = new McpServer({ name: "equxi-payout", version: "1.0.0" });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const id = z.string().uuid();
  server.registerTool("claim_payout", {
    description: "Claim a signed payout once. Stop on any error. Only execute the returned terms within the configured Steve mandate.",
    inputSchema: { id },
  }, ({ id }) => result(() => store.claim(id)));
  server.registerTool("check_payout_quote", {
    description: "Check the actual MultiHopper quote against the signed terms. Pass the quote fields as returned by MultiHopper. Stop on any error.",
    inputSchema: {
      id, network: z.string(), agentWallet: z.string(), recipient: z.string(),
      mint: z.string(), amountRaw: z.string(), debitRaw: z.string(),
    },
  }, ({ id, ...quote }) => result(() => store.checkQuote(id, quote)));
  server.registerTool("record_route", {
    description: "Attach a returned MultiHopper route ID and Solana transaction signature to the existing claim. This does not verify settlement.",
    inputSchema: { id, routeId: z.string(), transactionSignature: z.string() },
  }, ({ id, routeId, transactionSignature }) => result(() => store.report(id, routeId, transactionSignature)));
  res.once("close", () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, data);
}

const server = createServer(async (req, res) => {
  try {
    check(!req.headers.origin || req.headers.origin === origin, "Origin rejected.", 403);
    const path = new URL(req.url, origin).pathname;
    if (path === "/mcp") return await handleMcp(req, res);
    if (req.method === "GET" && Object.hasOwn(files, path)) {
      const [name, type] = files[path];
      res.writeHead(200, {
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
      return res.end(readFileSync(require("node:path").join(__dirname, name)));
    }
    check(authorized(req, operator), "Operator token required.", 401);
    if (path === "/payouts" && req.method === "POST") return reply(res, 201, store.create(await body(req)));
    const match = /^\/payouts\/([0-9a-f-]{36})(\/approve)?$/.exec(path);
    if (match && req.method === "GET" && !match[2]) return reply(res, 200, store.read(match[1]));
    if (match?.[2] && req.method === "POST") {
      const { signature } = await body(req);
      return reply(res, 200, store.approve(match[1], signature));
    }
    return reply(res, 404, { error: "Not found." });
  } catch (error) {
    if (!res.headersSent) reply(res, error.status || 500, { error: error.status ? error.message : "Payout operation failed." });
    else res.end();
    if (!error.status) console.error(error);
  }
});
server.listen(Number(process.env.PORT || 4322), process.env.PAYOUT_HOST || "127.0.0.1", () => {
  console.log("Equxi Payout Agent at", origin);
});
