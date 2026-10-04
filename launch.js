/**
 * Launch with safety escrow — renders the Meteora DBC launch evidence.
 *
 * Deliberately a plain script in an IIFE, matching `explorer.js`: the site is
 * static files on Vercel with no bundler, so anything fancier would need a
 * build step that does not exist.
 *
 * Three reads drive the page:
 *
 *   * `meteora-launch/launch-steps.json` — the ten transactions, in order.
 *   * `meteora-launch/launch-state.json` — the recorded addresses, so the page
 *     links to the same objects the launch script wrote down.
 *   * `/api/trust?agent=…` — the live read-back, graded on every page load.
 *
 * Nothing fetched is trusted as HTML: every interpolation goes through `esc()`.
 * A failure to load is rendered as a failure, never as an empty-but-passing
 * launch — the same rule the Explorer follows.
 */
(function () {
  "use strict";

  var STEPS_URL = "/meteora-launch/launch-steps.json";
  var STATE_URL = "/meteora-launch/launch-state.json";
  var TRUST_URL = "/api/trust?agent=";
  var BADGE_URL = "/api/badge?agent=";
  var AGENT = "9CvFbUciyP4APMVyzjLiR2znFmMTEPNqfGAP37PDNU4J";
  var EXPLORER = "https://explorer.solana.com";

  var el = {
    steps: document.getElementById("launchSteps"),
    notice: document.getElementById("stepsNotice"),
    summary: document.getElementById("stepsSummary"),
    state: document.getElementById("launchState"),
    card: document.getElementById("agentCard"),
    agentNotice: document.getElementById("agentNotice"),
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function short(value, keep) {
    var k = keep || 8;
    var s = String(value || "");
    return s.length > k + 8 ? s.slice(0, k) + "\u2026" + s.slice(-4) : s;
  }

  function txLink(tx, label) {
    return (
      '<a class="lx-link" href="' +
      EXPLORER +
      "/tx/" +
      esc(tx) +
      '?cluster=devnet" target="_blank" rel="noopener">' +
      esc(label) +
      ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>'
    );
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error("HTTP " + res.status + " from " + url);
        return body;
      });
    });
  }

  function fail(node, message) {
    node.className = "lx-notice bad";
    node.textContent = message;
  }

  function renderSteps(payload) {
    if (payload && payload.summary && el.summary) el.summary.textContent = payload.summary;
    var steps = payload && payload.steps;
    if (!Array.isArray(steps) || !steps.length) {
      el.steps.innerHTML = "";
      fail(el.notice, "The step list did not load — shown as a failure, not as an empty launch.");
      return;
    }
    el.steps.innerHTML = steps
      .map(function (step, i) {
        return (
          '<li class="lx-step">' +
          '<div class="lx-step-n">' + (i + 1) + "</div>" +
          '<div class="lx-step-body">' +
          '<div class="lx-step-head"><code>' + esc(step.label) + "</code>" +
          (step.tx ? txLink(step.tx, short(step.tx)) : "") +
          "</div>" +
          "<p>" + esc(step.detail) + "</p>" +
          "</div></li>"
        );
      })
      .join("");
  }

  function renderState(state) {
    if (!el.state) return;
    var rows = [
      ["DBC config", state && state.config],
      ["DBC pool", state && state.pool],
      ["Token mint", state && state.baseMint],
      ["DAMM v2 config", state && state.dammConfig],
      ["Equxi bond", state && state.bond],
    ].filter(function (row) {
      return !!row[1];
    });
    if (!rows.length) {
      el.state.innerHTML = "";
      return;
    }
    el.state.innerHTML = rows
      .map(function (row) {
        return (
          '<a class="lx-state" href="' +
          EXPLORER +
          "/address/" +
          esc(row[1]) +
          '?cluster=devnet" target="_blank" rel="noopener"><span>' +
          esc(row[0]) +
          "</span><code>" +
          esc(short(row[1], 10)) +
          "</code></a>"
        );
      })
      .join("");
  }

  function renderAgent(payload) {
    var agent = payload && payload.agents && payload.agents[0];
    if (!agent || !agent.profile) {
      el.card.innerHTML = "";
      fail(el.agentNotice, "The read API did not return this agent. That is shown as a failure rather than glossed over.");
      return;
    }
    var p = agent.profile;
    var bond = p.bond || {};
    var rows = [
      ["Grade", p.grade + " \u00b7 " + p.score + "/100"],
      ["Recorded collateral", (bond.amountSol != null ? bond.amountSol : "?") + " SOL"],
      ["Locked", bond.locked ? "yes" : "no"],
      ["Slashable now", bond.isActive ? "yes" : "no"],
      ["Withdrawable", bond.withdrawable ? "yes" : "not yet (unbonding window)"],
      ["Slashes recorded", String((p.stats && p.stats.slashCount) || 0)],
    ];
    el.card.innerHTML =
      '<div class="lx-agent-head"><div>' +
      '<div class="lx-agent-name">' +
      esc(agent.name) +
      ' <span class="lx-grade g-' + esc(p.grade) + '">' + esc(p.grade) + "</span></div>" +
      '<div class="lx-agent-sub">' + esc(agent.address) + "</div>" +
      "</div>" +
      '<img src="' + BADGE_URL + esc(AGENT) + '" alt="Equxi trust badge for ' +
      esc(agent.name) + '" height="20" /></div>' +
      '<div class="lx-grid">' +
      rows
        .map(function (row) {
          return '<div class="lx-row"><span>' + esc(row[0]) + "</span><strong>" + esc(row[1]) + "</strong></div>";
        })
        .join("") +
      "</div>" +
      '<div class="lx-links">' +
      '<a class="lx-link" href="' + TRUST_URL + esc(AGENT) +
      '" target="_blank" rel="noopener">/api/trust?agent=\u2026 <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '<a class="lx-link" href="' + EXPLORER + "/address/" + esc(AGENT) +
      '?cluster=devnet" target="_blank" rel="noopener">agent on the explorer <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '<a class="lx-link" href="explorer.html?agent=' + esc(AGENT) + '">open in the Trust Explorer \u2192</a>' +
      "</div>";
  }

  function renderAgentError(err) {
    el.card.innerHTML = "";
    fail(el.agentNotice, "Could not read the agent: " + (err && err.message ? err.message : String(err)));
  }

  fetchJson(STEPS_URL).then(renderSteps).catch(function (err) {
    fail(el.notice, "Could not load the step list: " + (err && err.message ? err.message : String(err)));
  });

  // The addresses are supporting evidence; the steps above are the claim.
  // A missing state file leaves the page coherent rather than half-broken.
  fetchJson(STATE_URL).then(renderState).catch(function () {});

  fetchJson(TRUST_URL + AGENT).then(renderAgent).catch(renderAgentError);
})();
